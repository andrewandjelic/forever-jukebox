import type { Edge } from "../engine/types";
import { JukeboxViz } from "./JukeboxViz";

export class JukeboxController {
  private readonly viz: JukeboxViz;

  constructor(vizLayer: HTMLElement) {
    this.viz = new JukeboxViz(vizLayer);
  }

  getCount() {
    return this.viz.getCount();
  }

  setActiveIndex(index: number) {
    this.viz.setActiveIndex(index);
  }

  setVisible(visible: boolean) {
    this.viz.setVisible(visible);
  }

  setData(data: Parameters<JukeboxViz["setData"]>[0]) {
    this.viz.setData(data);
  }

  setAnchorHighlightEnabled(enabled: boolean) {
    this.viz.setAnchorHighlightEnabled(enabled);
  }

  setWaveformSource(source: Parameters<JukeboxViz["setWaveformSource"]>[0]) {
    this.viz.setWaveformSource(source);
  }

  refresh() {
    this.viz.refresh();
  }

  canFollowCam(index: number) {
    return this.viz.canFollowCam(index);
  }

  setFollowCam(on: boolean) {
    this.viz.setFollowCam(on);
  }

  setMotion(on: boolean) {
    this.viz.setMotion(on);
  }

  resizeNow() {
    this.viz.resizeNow();
  }

  resizeActive() {
    this.viz.resizeActive();
  }

  // The jump the engine has decided to take next, or nulls when none is in
  // sight: its arc lights up as the playhead closes in.
  setUpcomingJump(from: number | null, to: number | null) {
    this.viz.setUpcomingJump(from, to);
  }

  update(index: number, animate: boolean, previousIndex: number | null) {
    this.viz.update(index, animate, previousIndex);
  }

  reset() {
    this.viz.reset();
  }

  destroy() {
    this.viz.destroy();
  }

  setOnSelect(handler: (index: number) => void) {
    this.viz.setOnSelect(handler);
  }

  setOnEdgeSelect(handler: (edge: Edge | null) => void) {
    this.viz.setOnEdgeSelect(handler);
  }

  setSelectedEdge(edge: Edge | null) {
    this.viz.setSelectedEdge(edge);
  }

  setSelectedEdgeActive(edge: Edge | null) {
    this.viz.setSelectedEdgeActive(edge);
  }
}
