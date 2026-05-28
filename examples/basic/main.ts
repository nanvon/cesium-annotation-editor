import {
  Cartesian3,
  ImageryLayer,
  Math as CesiumMath,
  SceneMode,
  UrlTemplateImageryProvider,
  Viewer,
  WebMercatorTilingScheme
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { CesiumAnnotationEditor } from '../../src';
import '../../src/styles.css';
import './style.css';

const amapProvider = new UrlTemplateImageryProvider({
  url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
  subdomains: ['1', '2', '3', '4'],
  minimumLevel: 3,
  maximumLevel: 18,
  tilingScheme: new WebMercatorTilingScheme(),
  credit: '高德卫星图'
});

const viewer = new Viewer('cesiumContainer', {
  animation: false,
  timeline: false,
  geocoder: false,
  sceneMode: SceneMode.SCENE3D,
  sceneModePicker: false,
  baseLayer: new ImageryLayer(amapProvider),
  baseLayerPicker: false,
  navigationHelpButton: false,
  homeButton: false,
  infoBox: false,
  selectionIndicator: false,
  skyBox: false,
  skyAtmosphere: false
});

viewer.camera.setView({
  destination: Cartesian3.fromDegrees(117.2272, 31.8206, 26000),
  orientation: {
    heading: CesiumMath.toRadians(0),
    pitch: CesiumMath.toRadians(-90),
    roll: 0
  }
});

const editor = new CesiumAnnotationEditor(viewer, {
  toolbar: {
    position: 'top-left'
  },
  circle: {
    minRadius: 50,
    maxRadius: 5000000
  },
  snapping: {
    enabled: true,
    snapDistance: 20
  }
});

const mode = document.querySelector<HTMLParagraphElement>('#mode');
const count = document.querySelector<HTMLParagraphElement>('#count');
const output = document.querySelector<HTMLPreElement>('#output');
const exportButton = document.querySelector<HTMLButtonElement>('#export');
const clearButton = document.querySelector<HTMLButtonElement>('#clear');

function refresh(): void {
  if (mode) {
    mode.textContent = `mode: ${editor.getMode()}`;
  }
  if (count) {
    count.textContent = `annotations: ${editor.getAnnotations().length}`;
  }
}

editor.on('modechange', refresh);
editor.on('change', refresh);
editor.on('select', refresh);
refresh();

exportButton?.addEventListener('click', () => {
  if (output) {
    output.textContent = JSON.stringify(editor.toJSON(), null, 2);
  }
});

clearButton?.addEventListener('click', () => {
  editor.clearAnnotations();
  if (output) {
    output.textContent = '';
  }
});

Object.assign(window, { viewer, editor });
