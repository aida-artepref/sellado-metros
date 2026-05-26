import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Box3Like } from "../domain/vector";
import { boxCenter, boxSize } from "../domain/vector";
import type { IfcElementGeometry, SealJoint } from "../domain/model";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

const INACTIVE_JOINT_COLOR = 0xcbd5e1;
const CORNER_JOINT_COLOR = 0xf59e0b;

function makePanelTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Missing 2D canvas context");

  context.fillStyle = "#d8e1e9";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "rgba(92, 109, 126, 0.22)";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(-12, 96);
  context.lineTo(96, -12);
  context.moveTo(20, 108);
  context.lineTo(108, 20);
  context.stroke();

  context.strokeStyle = "rgba(255, 255, 255, 0.26)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, 26);
  context.lineTo(96, 26);
  context.moveTo(0, 70);
  context.lineTo(96, 70);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.18, 0.18);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const PANEL_TEXTURE = makePanelTexture();

function materialForElement(element: IfcElementGeometry): THREE.Material {
  if (element.kind === "wall") {
    return new THREE.MeshStandardMaterial({
      color: 0xcad5df,
      roughness: 0.88,
      metalness: 0.02,
      map: PANEL_TEXTURE,
    });
  }

  const base = element.kind === "column" ? 0x94a3b8 : 0xd8dee6;
  return new THREE.MeshStandardMaterial({
    color: base,
    roughness: 0.82,
    metalness: 0.04,
  });
}

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function facadeColorHex(facadeKey: string): string {
  const hash = hashText(facadeKey);
  const hue = hash % 360;
  const saturation = 62 + (hash % 12);
  const lightness = 48 + (hash % 10);
  return new THREE.Color().setHSL(hue / 360, saturation / 100, lightness / 100).getHexString();
}

function colorForJoint(joint: SealJoint): number {
  if (joint.type === "corner") return CORNER_JOINT_COLOR;
  return Number.parseInt(facadeColorHex(joint.facadeKey), 16);
}

export class SealViewer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private modelGroup = new THREE.Group();
  private jointGroup = new THREE.Group();
  private animationId?: number;
  private jointClickHandler?: (jointId: string) => void;
  private pointerDownPosition?: { x: number; y: number };

  constructor(private readonly container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf6f7f9);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100000);
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(40, 60, 60);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = false;

    const hemisphere = new THREE.HemisphereLight(0xf8fbff, 0xd6dde7, 1.45);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
    keyLight.position.set(48, 64, 38);
    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.55);
    fillLight.position.set(-36, 28, -24);
    this.scene.add(hemisphere, keyLight, fillLight);

    const grid = new THREE.GridHelper(120, 60, 0xcbd5e1, 0xe5e7eb);
    grid.material.transparent = true;
    grid.material.opacity = 0.42;
    this.scene.add(grid);
    this.scene.add(this.modelGroup, this.jointGroup);

    window.addEventListener("resize", this.resize);
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("click", this.handleClick);
    this.resize();
    this.animate();
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("click", this.handleClick);
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.clearGroup(this.modelGroup);
    this.clearGroup(this.jointGroup);
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  setModel(elements: IfcElementGeometry[], modelBox: Box3Like): void {
    this.clearGroup(this.modelGroup);

    for (const element of elements) {
      const material = materialForElement(element);
      for (const meshData of element.meshes) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(meshData.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
        geometry.computeVertexNormals();

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${element.kind}:${element.expressId}:${element.name}`;
        mesh.userData = { expressId: element.expressId };
        this.modelGroup.add(mesh);

        const edges = new THREE.EdgesGeometry(geometry, 35);
        const edgeLines = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({
            color: 0x6b7280,
            transparent: true,
            opacity: 0.32,
          }),
        );
        edgeLines.renderOrder = 1;
        edgeLines.userData = { expressId: element.expressId };
        this.modelGroup.add(edgeLines);
      }
    }

    this.fitToBox(modelBox);
  }

  setJointClickHandler(handler?: (jointId: string) => void): void {
    this.jointClickHandler = handler;
  }

  setJoints(joints: SealJoint[], inactiveJointIds: ReadonlySet<string> = new Set()): void {
    this.clearGroup(this.jointGroup);

    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);

    for (const joint of joints) {
      const geometry = new LineGeometry();

      geometry.setPositions([
        joint.start.x,
        joint.start.y,
        joint.start.z,
        joint.end.x,
        joint.end.y,
        joint.end.z,
      ]);

      const isInactive = inactiveJointIds.has(joint.id);
      const material = new LineMaterial({
        color: isInactive ? INACTIVE_JOINT_COLOR : colorForJoint(joint),
        linewidth: 6,
        depthTest: false,
        depthWrite: false,
        transparent: isInactive,
        opacity: isInactive ? 0.35 : 1,
      });

      material.resolution.set(width, height);

      const line = new Line2(geometry, material);
      line.name = `${joint.type}:${joint.id}`;
      line.renderOrder = 999;
      line.userData = { jointId: joint.id, facadeKey: joint.facadeKey, relatedFacadeKeys: joint.relatedFacadeKeys };
      line.computeLineDistances();

      this.jointGroup.add(line);
    }
  }

  setIsolation(visibleElementIds?: ReadonlySet<number>, visibleFacadeKeys?: ReadonlySet<string>): void {
    this.modelGroup.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      if (visibleElementIds === undefined) {
        object.visible = true;
        return;
      }

      const expressId = object.userData?.expressId;
      object.visible = typeof expressId === "number" && visibleElementIds.has(expressId);
    });

    this.jointGroup.traverse((object) => {
      if (object === this.jointGroup) return;
      const relatedFacadeKeys = Array.isArray(object.userData?.relatedFacadeKeys) ? object.userData.relatedFacadeKeys : [];
      object.visible = visibleFacadeKeys === undefined || relatedFacadeKeys.some((key: string) => visibleFacadeKeys.has(key));
    });
  }

  private resize = (): void => {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);

    this.jointGroup.traverse((object) => {
      const material = (object as THREE.Object3D & { material?: THREE.Material }).material;

      if (material instanceof LineMaterial) {
        material.resolution.set(width, height);
      }
    });
  };

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      if ("geometry" in child && child.geometry instanceof THREE.BufferGeometry) child.geometry.dispose();
      if ("material" in child) {
        const material = child.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else if (material instanceof THREE.Material) material.dispose();
      }
    }
  }

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerDownPosition = { x: event.clientX, y: event.clientY };
  };

  private handleClick = (event: MouseEvent): void => {
    if (!this.jointClickHandler || !this.pointerDownPosition) return;

    const deltaX = event.clientX - this.pointerDownPosition.x;
    const deltaY = event.clientY - this.pointerDownPosition.y;
    if (Math.hypot(deltaX, deltaY) > 4) return;

    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(this.jointGroup.children, false);
    const hit = intersections.find((entry) => typeof entry.object.userData?.jointId === "string");
    if (!hit) return;

    this.jointClickHandler(hit.object.userData.jointId);
    this.pointerDownPosition = undefined;
  };

  private fitToBox(box: Box3Like): void {
    const center = boxCenter(box);
    const size = boxSize(box);

    const maxDim = Math.max(size.x, size.y, size.z, 10);

    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const cameraDistance = (maxDim / 2) / Math.tan(fov / 2);

    const fitOffset = 1.45;

    /**
     * Modelo Y-up:
     * X/Z = planta
     * Y   = altura
     *
     * Por eso la componente Y debe ser positiva.
     */
    const direction = new THREE.Vector3(0.85, 0.65, 0.85).normalize();

    this.controls.target.set(center.x, center.y, center.z);

    this.camera.position.copy(
      new THREE.Vector3(center.x, center.y, center.z).add(direction.multiplyScalar(cameraDistance * fitOffset)),
    );

    this.camera.near = Math.max(cameraDistance / 1000, 0.01);
    this.camera.far = cameraDistance * 20 + maxDim * 10;
    this.camera.updateProjectionMatrix();

    this.controls.minDistance = maxDim * 0.05;
    this.controls.maxDistance = maxDim * 10;

    this.controls.update();
  }
}
