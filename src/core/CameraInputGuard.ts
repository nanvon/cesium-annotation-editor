import type { Viewer } from 'cesium';

interface CameraState {
  enableInputs: boolean;
  enableRotate: boolean;
  enableTranslate: boolean;
  enableZoom: boolean;
  enableTilt: boolean;
  enableLook: boolean;
}

export class CameraInputGuard {
  private state: CameraState | null = null;
  private depth = 0;

  constructor(private readonly viewer: Viewer) {}

  lock(): void {
    this.depth += 1;
    if (this.depth > 1) {
      return;
    }

    const controller = this.viewer.scene.screenSpaceCameraController;
    this.state = {
      enableInputs: controller.enableInputs,
      enableRotate: controller.enableRotate,
      enableTranslate: controller.enableTranslate,
      enableZoom: controller.enableZoom,
      enableTilt: controller.enableTilt,
      enableLook: controller.enableLook
    };
    controller.enableInputs = false;
  }

  unlock(): void {
    if (this.depth === 0) {
      return;
    }

    this.depth -= 1;
    if (this.depth > 0 || !this.state) {
      return;
    }

    const controller = this.viewer.scene.screenSpaceCameraController;
    controller.enableInputs = this.state.enableInputs;
    controller.enableRotate = this.state.enableRotate;
    controller.enableTranslate = this.state.enableTranslate;
    controller.enableZoom = this.state.enableZoom;
    controller.enableTilt = this.state.enableTilt;
    controller.enableLook = this.state.enableLook;
    this.state = null;
  }

  forceUnlock(): void {
    this.depth = this.state ? 1 : 0;
    this.unlock();
  }
}
