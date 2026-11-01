import init, {
  BeatNetworks,
  analyze_json_with_model_progress,
  decode_beats,
  default_config_json,
  extract_features_json,
  feature_columns_json,
  validate_config_json,
} from "./pkg/madmom_beats_port_wasm.js";

let ready = false;
let readyPromise = null;
let modelJson = null;
let modelWeights = null;
let configJson = null;
let networks = null;

const FRIENDLY_MEMORY_ERROR =
  "Beat detection ran out of memory for this track.";

function formatMadmomError(err) {
  const name =
    err && typeof err === "object" && "name" in err
      ? String(err.name)
      : "Error";
  const rawMessage =
    err && typeof err === "object" && "message" in err
      ? String(err.message)
      : String(err);
  const message = rawMessage?.trim() || "unknown madmom worker failure";
  if (message.toLowerCase().includes("unreachable")) {
    return `${name}: ${FRIENDLY_MEMORY_ERROR}`;
  }
  return `${name}: ${message}`;
}

async function ensureReady() {
  if (ready) return;
  if (!readyPromise) {
    readyPromise = init();
  }
  await readyPromise;
  if (!modelJson) {
    const modelRes = await fetch("./models/downbeats_blstm.json");
    modelJson = await modelRes.text();
  }
  if (!modelWeights) {
    const weightsRes = await fetch("./models/downbeats_blstm_weights.npz");
    const buf = await weightsRes.arrayBuffer();
    modelWeights = new Uint8Array(buf);
  }
  if (!configJson) {
    configJson = default_config_json();
    const validation = validate_config_json(configJson);
    if (validation !== null) {
      throw new Error(
        `Invalid madmom default config: ${JSON.stringify(validation)}`,
      );
    }
  }
  ready = true;
}

function getNetworks() {
  if (!networks) {
    networks = new BeatNetworks(modelJson, modelWeights);
  }
  return networks;
}

// One bar length (beats per bar) of the default config.
function configForMeter(meter) {
  const config = JSON.parse(configJson);
  if (meter !== undefined) {
    config.dbn.beats_per_bar = [meter];
  }
  return JSON.stringify(config);
}

// The whole analysis in one call ("analyze"), or one stage of it for
// spreading the work over several of these workers: "features", then
// "networks" (any subset, any worker), then "decode" on the outputs in
// network order, optionally once per bar length (see beatDetection.ts).
const handlers = {
  // Loads the engine and model ahead of the first real request.
  init() {
    getNetworks();
    return null;
  },
  analyze({ samples, sampleRate }) {
    const progressCb = (stage, progress) => {
      self.postMessage({ type: "progress", stage, progress });
    };
    return analyze_json_with_model_progress(
      samples,
      sampleRate,
      configJson,
      modelJson,
      modelWeights,
      progressCb,
    );
  },
  features({ samples, sampleRate }) {
    const features = extract_features_json(samples, sampleRate, configJson);
    return {
      features,
      columns: feature_columns_json(configJson),
      networks: getNetworks().count(),
      meters: JSON.parse(configJson).dbn.beats_per_bar,
    };
  },
  networks({ features, columns, indices }) {
    const nets = getNetworks();
    nets.set_features(features, columns);
    const outputs = [];
    for (const index of indices) {
      outputs.push(nets.run(index));
      self.postMessage({ type: "network-done", index });
    }
    return { outputs };
  },
  decode({ outputs, networks: count, columns, meter }) {
    const progressCb = (_stage, progress) => {
      self.postMessage({ type: "progress", stage: 2, progress });
    };
    return decode_beats(outputs, count, columns, configForMeter(meter), progressCb);
  },
};

self.onmessage = async (event) => {
  const handler = handlers[event.data?.type];
  if (!handler) return;
  try {
    await ensureReady();
    const payload = handler(event.data);
    const transfer = [];
    if (payload?.features) transfer.push(payload.features.buffer);
    if (payload?.outputs) transfer.push(...payload.outputs.map((o) => o.buffer));
    self.postMessage({ type: "result", payload }, transfer);
  } catch (err) {
    self.postMessage({ type: "error", message: formatMadmomError(err) });
  }
};
