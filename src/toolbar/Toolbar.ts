import type { EditorMode, ToolbarButtonName, ToolbarOptions } from '../types';

interface ToolbarCallbacks {
  onButtonClick: (button: ToolbarButtonName) => void;
}

const defaultButtons: ToolbarButtonName[] = ['drawPoint', 'drawPolyline', 'drawPolygon', 'drawCircle', 'editMode', 'dragMode'];

const defaultLabels: Record<ToolbarButtonName, string> = {
  drawPoint: 'Draw Marker',
  drawPolyline: 'Draw Polyline',
  drawCircle: 'Draw Circle',
  drawPolygon: 'Draw Polygons',
  editMode: 'Edit Layers',
  dragMode: 'Drag Layers',
  finish: 'Finish',
  cancel: 'Cancel',
  removeLastVertex: 'Remove Last Vertex'
};

const buttonModes: Partial<Record<ToolbarButtonName, EditorMode>> = {
  drawPoint: 'draw:point',
  drawPolyline: 'draw:polyline',
  drawCircle: 'draw:circle',
  drawPolygon: 'draw:polygon',
  editMode: 'edit',
  dragMode: 'drag'
};

const buttonIcons: Partial<Record<ToolbarButtonName, string>> = {
  drawPoint: 'marker',
  drawPolyline: 'polyline',
  drawPolygon: 'polygon',
  drawCircle: 'circle',
  editMode: 'edit',
  dragMode: 'drag'
};

const buttonActions: Partial<Record<ToolbarButtonName, ToolbarButtonName[]>> = {
  drawPoint: ['cancel'],
  drawPolyline: ['finish', 'removeLastVertex', 'cancel'],
  drawPolygon: ['finish', 'removeLastVertex', 'cancel'],
  drawCircle: ['cancel']
};

export class Toolbar {
  private readonly root = document.createElement('div');
  private readonly main = document.createElement('div');
  private readonly buttons = new Map<ToolbarButtonName, HTMLButtonElement>();
  private readonly buttonContainers = new Map<ToolbarButtonName, HTMLDivElement>();
  private readonly actionContainers = new Map<ToolbarButtonName, HTMLDivElement>();
  private readonly actionButtons = new Set<HTMLButtonElement>();
  private readonly container: HTMLElement;
  private readonly labels: Record<ToolbarButtonName, string>;
  private destroyed = false;
  private disabled = false;

  constructor(
    viewerContainer: HTMLElement,
    options: ToolbarOptions,
    private readonly callbacks: ToolbarCallbacks
  ) {
    this.container = options.container ?? viewerContainer;
    this.labels = { ...defaultLabels, ...options.labels };
    this.root.className = `cae-toolbar cae-toolbar--${options.position ?? 'top-left'}`;
    this.main.className = 'cae-toolbar__main';
    this.root.append(this.main);

    const buttons = options.buttons ?? defaultButtons;
    for (const button of buttons) {
      this.main.append(this.createMainButton(button, this.labels[button]));
    }

    this.container.append(this.root);
  }

  setMode(mode: EditorMode): void {
    let activeButton: ToolbarButtonName | null = null;

    for (const [button, element] of this.buttons) {
      const active = buttonModes[button] === mode;
      element.classList.toggle('is-active', active);
      element.setAttribute('aria-pressed', String(active));
      this.buttonContainers.get(button)?.classList.toggle('is-active', active);
      if (active) {
        activeButton = button;
      }
    }

    this.renderActions(activeButton);
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    for (const button of this.buttons.values()) {
      button.disabled = disabled;
    }
    for (const button of this.actionButtons) {
      button.disabled = disabled;
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.root.remove();
    this.buttons.clear();
    this.buttonContainers.clear();
    this.actionContainers.clear();
    this.actionButtons.clear();
  }

  private createMainButton(name: ToolbarButtonName, label: string): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'cae-toolbar__button-container';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cae-toolbar__button';
    button.dataset.caeButton = name;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', 'false');

    const icon = document.createElement('span');
    icon.className = `cae-toolbar__icon cae-toolbar__icon--${buttonIcons[name] ?? name}`;
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);

    button.addEventListener('click', () => this.callbacks.onButtonClick(name));

    const actions = document.createElement('div');
    actions.className = 'cae-toolbar__actions-container';
    actions.hidden = true;

    container.append(button, actions);
    this.buttons.set(name, button);
    this.buttonContainers.set(name, container);
    this.actionContainers.set(name, actions);
    return container;
  }

  private renderActions(activeButton: ToolbarButtonName | null): void {
    this.actionButtons.clear();

    for (const [button, container] of this.actionContainers) {
      container.replaceChildren();
      const actions = activeButton === button ? (buttonActions[button] ?? []) : [];
      container.hidden = actions.length === 0;

      for (const action of actions) {
        const actionButton = this.createActionButton(action, this.labels[action]);
        container.append(actionButton);
        this.actionButtons.add(actionButton);
      }
    }
  }

  private createActionButton(name: ToolbarButtonName, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cae-toolbar__action cae-toolbar__action--${name}`;
    button.dataset.caeAction = name;
    button.textContent = label;
    button.title = label;
    button.disabled = this.disabled;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => this.callbacks.onButtonClick(name));
    return button;
  }
}
