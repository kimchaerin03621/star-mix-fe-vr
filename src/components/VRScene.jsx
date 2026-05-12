import React, { useRef, useMemo, useEffect, Suspense } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { XR, IfInSessionMode, useXR } from '@react-three/xr';
import * as THREE from 'three';

function LoggerComponent() {
  const mode = useXR((state) => state.mode);
  const session = useXR((state) => state.session);
  
  useEffect(() => {
    console.log("XR Mode:", mode, "Session active:", !!session);
  }, [mode, session]);
  
  return null;
}

function Stars3D({ starColors }) {
  const count = 3000; // More stars for full 3D!
  const meshRef = useRef();
  
  // Load star texture
  const texture = useLoader(THREE.TextureLoader, '/star.png');
  
  // Get controllers for interaction
  const controllers = useXR((state) => state.controllers);
  
  // Generate random positions, velocities, and initial side (left/right)
  const [positions, velocities, originals, sides] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const orig = new Float32Array(count * 3);
    const side = new Uint8Array(count); // 0 for left, 1 for right
    
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Distribute in a sphere shell - Pushed further away!
      const radius = 8 + Math.random() * 20; // 8 to 28 meters
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.acos(2 * Math.random() - 1);
      
      pos[i3] = radius * Math.sin(theta) * Math.cos(phi);
      pos[i3 + 1] = radius * Math.sin(theta) * Math.sin(phi);
      pos[i3 + 2] = radius * Math.cos(theta);
      
      orig[i3] = pos[i3];
      orig[i3 + 1] = pos[i3 + 1];
      orig[i3 + 2] = pos[i3 + 2];
      
      vel[i3] = 0;
      vel[i3 + 1] = 0;
      vel[i3 + 2] = 0;
      
      // Separate left (pink) and right (white)
      // Positive X is right, Negative X is left in Three.js
      side[i] = pos[i3] < 0 ? 0 : 1;
    }
    return [pos, vel, orig, side];
  }, []);

  // Update colors when starColors changes
  const colors = useMemo(() => {
    const col = new Float32Array(count * 3);
    const leftColor = new THREE.Color(starColors?.left || '#ff007f');
    const rightColor = new THREE.Color(starColors?.right || '#ffffff');
    
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const color = sides[i] === 0 ? leftColor : rightColor;
      col[i3] = color.r;
      col[i3 + 1] = color.g;
      col[i3 + 2] = color.b;
    }
    return col;
  }, [starColors, sides]);

  // Ensure colors update in GPU
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.geometry.attributes.color.needsUpdate = true;
    }
  }, [colors]);

  const tempDir = useMemo(() => new THREE.Vector3(), []);
  
  useFrame((state, delta) => {
    const geom = meshRef.current.geometry;
    const posAttr = geom.attributes.position;
    
    const time = state.clock.getElapsedTime();
    
    // Interaction with controllers (Ray interaction)
    if (controllers) {
      const controllerArray = Array.isArray(controllers) 
        ? controllers 
        : (typeof controllers.values === 'function' ? Array.from(controllers.values()) : Object.values(controllers));
        
      controllerArray.forEach((c) => {
        const controllerObj = c.controller;
        if (!controllerObj) return;
        
        const cX = controllerObj.position.x;
        const cY = controllerObj.position.y;
        const cZ = controllerObj.position.z;
        
        // Forward direction is negative Z in Three.js
        tempDir.set(0, 0, -1).applyQuaternion(controllerObj.quaternion).normalize();
        const dX = tempDir.x;
        const dY = tempDir.y;
        const dZ = tempDir.z;
        
        for (let i = 0; i < count; i++) {
          const i3 = i * 3;
          const sX = posAttr.array[i3];
          const sY = posAttr.array[i3 + 1];
          const sZ = posAttr.array[i3 + 2];
          
          // Vector from controller to star
          const vX = sX - cX;
          const vY = sY - cY;
          const vZ = sZ - cZ;
          
          // Project onto ray
          const t = vX * dX + vY * dY + vZ * dZ;
          
          if (t > 0) { // Only affect stars in front
            // Closest point on ray
            const pX = cX + dX * t;
            const pY = cY + dY * t;
            const pZ = cZ + dZ * t;
            
            // Distance from star to ray
            const dx = sX - pX;
            const dy = sY - pY;
            const dz = sZ - pZ;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            const interactionRadius = 2.0; // 2 meters around the ray
            if (dist < interactionRadius) {
              const forceFactor = Math.pow(1 - dist / interactionRadius, 1.5);
              
              // Repel direction: from closest point on ray to star
              const rX = dx / (dist || 1);
              const rY = dy / (dist || 1);
              const rZ = dz / (dist || 1);
              
              // Apply velocity (push away from ray)
              const force = 0.03 * forceFactor;
              velocities[i3] += rX * force;
              velocities[i3 + 1] += rY * force;
              velocities[i3 + 2] += rZ * force;
            }
          }
        }
      });
    }
    
    // Physics update
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      
      // Gentle Brownian motion
      velocities[i3] += Math.sin(time * 2 + i) * 0.0003;
      velocities[i3 + 1] += Math.cos(time * 2 + i) * 0.0003;
      velocities[i3 + 2] += Math.sin(time * 3 + i) * 0.0003;
      
      // Spring force back to original
      const springPower = 0.005;
      velocities[i3] += (originals[i3] - posAttr.array[i3]) * springPower;
      velocities[i3 + 1] += (originals[i3 + 1] - posAttr.array[i3 + 1]) * springPower;
      velocities[i3 + 2] += (originals[i3 + 2] - posAttr.array[i3 + 2]) * springPower;
      
      // Update position
      posAttr.array[i3] += velocities[i3];
      posAttr.array[i3 + 1] += velocities[i3 + 1];
      posAttr.array[i3 + 2] += velocities[i3 + 2];
      
      // Decay velocity
      velocities[i3] *= 0.95;
      velocities[i3 + 1] *= 0.95;
      velocities[i3 + 2] *= 0.95;
    }
    
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={count}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial 
        size={0.22} 
        vertexColors={true} 
        sizeAttenuation={true}
        transparent={true}
        opacity={0.8}
        map={texture}
        alphaTest={0.01}
        depthWrite={false}
      />
    </points>
  );
}

export function VRScene({ store, starColors }) {
  return (
    <div style={{ 
      position: 'absolute', 
      top: 0, 
      left: 0, 
      width: '100vw', 
      height: '100vh', 
      pointerEvents: 'none',
      zIndex: 1 
    }}>
      <Canvas>
        <XR store={store}>
          <LoggerComponent />
          <IfInSessionMode accept={['immersive-vr']}>
            {/* Black background to cover the web view in VR */}
            <color attach="background" args={['#000000']} />
            
            <Suspense fallback={null}>
              <Stars3D starColors={starColors} />
            </Suspense>
          </IfInSessionMode>
        </XR>
      </Canvas>
    </div>
  );
}
