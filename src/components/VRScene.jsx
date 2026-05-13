import React, { useRef, useMemo, useEffect, Suspense, useState } from 'react';
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
      // Distribute stars between 2 and 15 meters
      const radius = 2 + Math.random() * 13;
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
  
  const isMouseDown = useRef(false);
  const mouseScreenPos = useRef({ x: 0, y: 0 });
  
  useEffect(() => {
    const onDown = () => { isMouseDown.current = true; };
    const onUp = () => { isMouseDown.current = false; };
    const onMove = (e) => {
      mouseScreenPos.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseScreenPos.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
    };
  }, []);
  
  useFrame((state, delta) => {
    const geom = meshRef.current.geometry;
    const posAttr = geom.attributes.position;
    
    const time = state.clock.getElapsedTime();
    
    // Interaction with controllers (Ray interaction)
    let interactionPoints = [];
    
    // 1. Try library store controllers and check trigger!
    if (controllers) {
      const controllerArray = typeof controllers.values === 'function' ? Array.from(controllers.values()) : Object.values(controllers);
      controllerArray.forEach((c) => {
        const obj = c.controller || c.grip || c;
        
        // Check if trigger is pressed! (Buttons[0] is usually trigger)
        const isTriggerPressed = c.inputSource?.gamepad?.buttons[0]?.pressed;
        
        // TEMPORARY: Disable trigger check to see if tracking works
        if (obj && obj.position) {
          interactionPoints.push(obj.position.clone());
        }
      });
    }
    
    // 2. Add MOUSE interaction for PC testing if mouse is pressed!
    if (isMouseDown.current) {
      // Unproject mouse position based on camera to support 360 degrees!
      const mouse3D = new THREE.Vector3(mouseScreenPos.current.x, mouseScreenPos.current.y, 0.5);
      mouse3D.unproject(state.camera);
      
      const dir = mouse3D.sub(state.camera.position).normalize();
      const mousePos = state.camera.position.clone().add(dir.multiplyScalar(10)); // 10 meters away
      
      interactionPoints.push(mousePos);
    }
    
    // Process all interaction points
    interactionPoints.forEach((pos) => {
      const cX = pos.x;
      const cY = pos.y;
      const cZ = pos.z;
      
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const sX = posAttr.array[i3];
        const sY = posAttr.array[i3 + 1];
        const sZ = posAttr.array[i3 + 2];
        
        // Distance between controller and star
        const dx = sX - cX;
        const dy = sY - cY;
        const dz = sZ - cZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        const interactionRadius = 5.0; // Narrower radius
        if (dist < interactionRadius) {
          const forceFactor = Math.pow(1 - dist / interactionRadius, 1.5);
          
          // Web page style interaction (Repel + Swirl) - Halved intensity
          const repelX = (dx / (dist || 1)) * 0.04;
          const repelY = (dy / (dist || 1)) * 0.04;
          const repelZ = (dz / (dist || 1)) * 0.04;
          
          const swirlX = (-dy / (dist || 1)) * 0.06;
          const swirlY = (dx / (dist || 1)) * 0.06;
          
          velocities[i3] += (repelX + swirlX) * forceFactor;
          velocities[i3 + 1] += (repelY + swirlY) * forceFactor;
          velocities[i3 + 2] += repelZ * forceFactor;
        }
      }
    });
    
    // Physics update
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      

      
      // Spring force back to original
      const springPower = 0.0002;
      velocities[i3] += (originals[i3] - posAttr.array[i3]) * springPower;
      velocities[i3 + 1] += (originals[i3 + 1] - posAttr.array[i3 + 1]) * springPower;
      velocities[i3 + 2] += (originals[i3 + 2] - posAttr.array[i3 + 2]) * springPower;
      
      // Update position
      posAttr.array[i3] += velocities[i3];
      posAttr.array[i3 + 1] += velocities[i3 + 1];
      posAttr.array[i3 + 2] += velocities[i3 + 2];
      
      // Decay velocity
      velocities[i3] *= 0.98;
      velocities[i3 + 1] *= 0.98;
      velocities[i3 + 2] *= 0.98;
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
        size={0.3} 
        vertexColors={true} 
        sizeAttenuation={true}
        transparent={true}
        opacity={0.8}
        map={texture}
        alphaTest={0.01}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function VRTestScene() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[0, 10, 0]} />
      <mesh position={[0, 1.6, -3]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="orange" />
      </mesh>
    </>
  );
}

export function VRScene({ store, starColors, isVRTest }) {
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
            <color attach="background" args={['#111111']} />
            
            {/* Foolproof way to block passthrough: a giant black sphere */}
            {/* Use #111111 instead of pure black #000000 because Quest 3 treats pure black as transparent! */}
            <mesh scale={[50, 50, 50]}>
              <sphereGeometry args={[1, 32, 32]} />
              <meshBasicMaterial color="#111111" side={THREE.BackSide} />
            </mesh>
            
            {isVRTest ? (
              <VRTestScene />
            ) : (
              <Suspense fallback={<mesh position={[0, 1.6, -2]}><boxGeometry args={[0.2, 0.2, 0.2]} /><meshBasicMaterial color="red" /></mesh>}>
                <Stars3D starColors={starColors} />
              </Suspense>
            )}
        </XR>
      </Canvas>
    </div>
  );
}
