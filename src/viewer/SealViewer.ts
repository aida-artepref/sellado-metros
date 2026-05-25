import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Box3Like } from "../domain/vector";
import { boxCenter, boxSize } from "../domain/vector";
import type { IfcElementGeometry, SealJoint } from "../domain/model";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

function materialForElement(element: IfcElementGeometry): THREE.Material {
  const base = element.kind === "wall" ? 0xb6c2cf : element.kind === "column" ? 0x8793a0 : 0xd0d4d8;
  return new THREE.MeshLambertMaterial({ color: base, transparent: true, opacity: element.kind === "wall" ? 0.72 : 0.35 });
}

function colorForJoint(type: SealJoint["type"]): number {
  if (type === "vertical") return 0xff3b30;
  if (type === "horizontal") return 0x147efb;
  return 0xffcc00;
}

export class SealViewer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private modelGroup = new THREE.Group();
  private jointGroup = new THREE.Group();
  private animationId?: number;

  constructor(private readonly container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf6f7f9);

this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100000);
this.camera.up.set(0, 1, 0);
this.camera.position.set(40, 60, 60);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
this.controls.enableDamping = true;
this.controls.dampingFactor = 0.08;
this.controls.screenSpacePanning = false;



    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    const directional = new THREE.DirectionalLight(0xffffff, 1.2);
    directional.position.set(30, 40, 60);
    this.scene.add(ambient, directional);

    const grid = new THREE.GridHelper(120, 60, 0xb0b0b0, 0xd6d6d6);
    this.scene.add(grid);
    this.scene.add(this.modelGroup, this.jointGroup);

    window.addEventListener("resize", this.resize);
    this.resize();
    this.animate();
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
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
        this.modelGroup.add(mesh);
      }
    }

    this.fitToBox(modelBox);
  }

setJoints(joints: SealJoint[]): void {
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

    const material = new LineMaterial({
      color: colorForJoint(joint.type),
      linewidth: 6,
      depthTest: false,
      depthWrite: false,
    });

    material.resolution.set(width, height);

    const line = new Line2(geometry, material);
    line.name = `${joint.type}:${joint.id}`;
    line.renderOrder = 999;
    line.computeLineDistances();

    this.jointGroup.add(line);
  }
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
    new THREE.Vector3(center.x, center.y, center.z).add(
      direction.multiplyScalar(cameraDistance * fitOffset)
    )
  );

  this.camera.near = Math.max(cameraDistance / 1000, 0.01);
  this.camera.far = cameraDistance * 20 + maxDim * 10;
  this.camera.updateProjectionMatrix();

  this.controls.minDistance = maxDim * 0.05;
  this.controls.maxDistance = maxDim * 10;

  this.controls.update();
}
}
