import * as THREE from "three";

export interface RigidBodyState {
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
}

const GRAVITY = -18;
const GROUND_RESTITUTION = 0.35;
const GROUND_FRICTION = 4.5;
const ANGULAR_DAMPING = 0.88;

/**
 * Cheap "rigid body" integration shared by car-damage debris and bystander
 * ragdolls: gravity, a bounce/friction response against a flat ground plane,
 * and damped tumbling. Not a real physics engine (no shape-aware collision,
 * no inertia tensor) -- just enough to sell a piece flying off or a person
 * getting knocked down.
 */
export function stepRigidBody(object: THREE.Object3D, state: RigidBodyState, dt: number, groundY = 0) {
  state.velocity.y += GRAVITY * dt;
  object.position.addScaledVector(state.velocity, dt);

  if (object.position.y <= groundY) {
    object.position.y = groundY;
    if (state.velocity.y < 0) {
      state.velocity.y = -state.velocity.y * GROUND_RESTITUTION;
      const frictionFactor = Math.max(0, 1 - GROUND_FRICTION * dt);
      state.velocity.x *= frictionFactor;
      state.velocity.z *= frictionFactor;
      state.angularVelocity.multiplyScalar(0.5);
    }
  }

  object.rotateX(state.angularVelocity.x * dt);
  object.rotateY(state.angularVelocity.y * dt);
  object.rotateZ(state.angularVelocity.z * dt);

  const damp = Math.pow(ANGULAR_DAMPING, dt * 60);
  state.angularVelocity.multiplyScalar(damp);
}

const LIFETIME = 30;
const FADE_DURATION = 3;

interface Piece {
  object: THREE.Object3D;
  state: RigidBodyState;
  age: number;
  materials: THREE.Material[];
}

/**
 * Owns detached car parts (bumpers, roof racks, wheels) after a hard crash.
 * Each piece tumbles via stepRigidBody, rests on the ground, then fades out
 * and is disposed after LIFETIME seconds. Materials are cloned at spawn time
 * so fading a detached piece never affects materials still in use elsewhere
 * (e.g. a shared bumper material on the rest of the car).
 */
export class DebrisSystem {
  readonly group = new THREE.Group();
  private pieces: Piece[] = [];

  spawn(object: THREE.Object3D, velocity: THREE.Vector3, angularVelocity: THREE.Vector3) {
    const materials: THREE.Material[] = [];
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const original = child.material;
      if (Array.isArray(original)) {
        const clones = original.map((m) => m.clone());
        child.material = clones;
        for (const m of clones) {
          m.transparent = true;
          materials.push(m);
        }
      } else {
        const clone = original.clone();
        child.material = clone;
        clone.transparent = true;
        materials.push(clone);
      }
    });

    this.group.add(object);
    this.pieces.push({
      object,
      state: { velocity: velocity.clone(), angularVelocity: angularVelocity.clone() },
      age: 0,
      materials,
    });
  }

  update(dt: number) {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const piece = this.pieces[i];
      piece.age += dt;
      stepRigidBody(piece.object, piece.state, dt);

      if (piece.age > LIFETIME - FADE_DURATION) {
        const t = Math.max(0, (LIFETIME - piece.age) / FADE_DURATION);
        for (const m of piece.materials) (m as THREE.MeshStandardMaterial).opacity = t;
      }

      if (piece.age >= LIFETIME) {
        this.group.remove(piece.object);
        for (const m of piece.materials) m.dispose();
        piece.object.traverse((child) => {
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        });
        this.pieces.splice(i, 1);
      }
    }
  }
}
