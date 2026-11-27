// 3D classroom background rendered with three.js.
// The static room is a model in backgrounds/3D (editable in Blender, see README).
// This file loads it, applies the cartoon look (toon shading + outlines) and adds
// the live parts: drifting clouds, swaying lamps, spinning globe, dust and lights.
// three.js loads lazily the first time the scene is shown; until it is ready
// (or if WebGL or the model is unavailable) the flat PNG behind the canvas stays visible.
(function () {
    const THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    const GLTF_LOADER_SRC = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
    const OUTLINE_COLOR = 0x3a2a1f;

    // Object-name prefixes from the model that get special treatment
    const NO_OUTLINE = [
        'Floor', 'Ceiling', 'Rug', 'WindowGlass', 'ChalkboardFace', 'ShelfBack', 'GlobeStem', 'GlobeSphere',
        'GlobeRing', 'LampCord', 'LampShade', 'LampBulb', 'Paper', 'StickyNote', 'CupPencil',
    ];
    // Lamps would throw a sun shadow across the chalkboard
    const NO_SHADOW_CAST = ['Floor', 'Ceiling', 'Wall_', 'Window', 'Rug', 'Lamp_', 'ChalkboardFace'];
    const UNLIT = ['LampBulb', 'WindowGlass'];
    const SMOOTH_SHADED = ['ChalkboardFace'];

    // Manchas stands in the room as a flat cutout of the current pose image (see setupMascot)
    const MASCOT_HEIGHT = 1.0; // metres from floor to ear tips, sitting cross-legged: about a seated person
    const MASCOT_DEFAULT_SPOT = { x: 0.3, z: 3.0 }; // front half of the rug; a `MascotSpot` object in the model overrides it
    // Pose images share a 944x1126 canvas; the character spans rows 19-1087
    const MASCOT_IMAGE = { width: 944, height: 1126, top: 19, bottom: 1087 };
    // Where the Zzz start, as a fraction of the image (matches the flat layout's offset)
    const MASCOT_ZZZ_POINT = { u: 0.62, v: 0.45 };
    // Height of the flat mascot as a fraction of the screen; the Zzz are sized for it
    const FLAT_MASCOT_SCREEN_HEIGHT = 0.54;

    let threeLoading = null;
    let canvas = null;
    let renderer = null;
    let scene = null;
    let camera = null;
    let world = null;
    let frameId = null;
    let active = false;
    let lastTime = 0;
    let host = null;
    let currentModel = null; // model the scene was built from
    let requestedModel = null; // latest model asked for by start()
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(script);
        });
    }

    function loadThree() {
        if (!threeLoading) {
            threeLoading = (window.THREE ? Promise.resolve() : loadScript(THREE_SRC))
                .then(() => (THREE.GLTFLoader ? null : loadScript(GLTF_LOADER_SRC)))
                .catch((e) => {
                    threeLoading = null;
                    throw e;
                });
        }
        return threeLoading;
    }

    function loadModel(src) {
        return new Promise((resolve, reject) => new THREE.GLTFLoader().load(src, resolve, undefined, reject));
    }

    // ---------- Texture helpers ----------

    function canvasTexture(width, height, draw) {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        draw(c.getContext('2d'), width, height);
        const tex = new THREE.CanvasTexture(c);
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        return tex;
    }

    function skyTexture() {
        const tex = canvasTexture(1024, 512, (ctx, w, h) => {
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, '#93cdf1');
            grad.addColorStop(1, '#e1f2fb');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            const clouds = [[120, 110], [430, 210], [760, 90], [900, 330], [260, 380]];
            clouds.forEach(([cx, cy]) => {
                for (let i = 0; i < 5; i++) {
                    ctx.beginPath();
                    ctx.ellipse(cx + (i - 2) * 26, cy + (i % 2) * -12, 38, 24, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
        });
        tex.wrapS = THREE.RepeatWrapping;
        return tex;
    }

    function glowTexture() {
        return canvasTexture(128, 128, (ctx, w, h) => {
            const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
            g.addColorStop(0, 'rgba(255,240,200,1)');
            g.addColorStop(0.4, 'rgba(255,220,160,0.35)');
            g.addColorStop(1, 'rgba(255,220,160,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
        });
    }

    // ---------- Scene setup ----------

    // True when the object, or one of its parents, is named with one of the prefixes
    function matchesName(object, prefixes) {
        for (let o = object; o; o = o.parent) {
            if (prefixes.some((p) => o.name.startsWith(p))) return true;
        }
        return false;
    }

    // Swap the model's PBR materials for the cartoon look, keeping the colors and textures
    // set in Blender. The model stores linear colors; the app renders in sRGB space.
    function styleModel(model) {
        const gradientMap = new THREE.DataTexture(new Uint8Array([120, 195, 255]), 3, 1, THREE.LuminanceFormat);
        gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
        gradientMap.generateMipmaps = false;
        gradientMap.needsUpdate = true;
        const lineMaterial = new THREE.LineBasicMaterial({ color: OUTLINE_COLOR });
        const converted = new Map();

        function convert(source, mesh) {
            const kind = matchesName(mesh, UNLIT) ? 'unlit' : matchesName(mesh, SMOOTH_SHADED) ? 'smooth' : 'toon';
            const key = source.uuid + kind;
            if (!converted.has(key)) {
                if (source.map) {
                    source.map.encoding = THREE.LinearEncoding;
                    source.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
                }
                const params = {
                    name: source.name,
                    color: source.color.clone().convertLinearToSRGB(),
                    map: source.map,
                    transparent: source.transparent,
                    opacity: source.opacity,
                    alphaTest: source.alphaTest,
                    side: source.side,
                };
                const material = kind === 'unlit' ? new THREE.MeshBasicMaterial(params)
                    : kind === 'smooth' ? new THREE.MeshLambertMaterial(params)
                    : new THREE.MeshToonMaterial(Object.assign(params, { gradientMap }));
                converted.set(key, material);
            }
            return converted.get(key);
        }

        // Blender may export its default camera and lights; the app brings its own
        const extras = [];
        model.traverse((o) => { if (o.isLight || o.isCamera) extras.push(o); });
        extras.forEach((o) => o.parent.remove(o));

        const meshes = [];
        model.traverse((o) => { if (o.isMesh) meshes.push(o); });
        meshes.forEach((mesh) => {
            mesh.material = Array.isArray(mesh.material)
                ? mesh.material.map((m) => convert(m, mesh))
                : convert(mesh.material, mesh);
            mesh.castShadow = !matchesName(mesh, NO_SHADOW_CAST);
            mesh.receiveShadow = true;
            if (!matchesName(mesh, NO_OUTLINE)) {
                mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), lineMaterial));
            }
        });
    }

    function buildScene(gltf) {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf2dcb9);

        const model = gltf.scene;
        styleModel(model);
        scene.add(model);
        scene.updateMatrixWorld(true);

        const animated = { lamps: [], globe: model.getObjectByName('GlobeSphere'), windowSkies: [], motes: null };
        const glowTex = glowTexture();

        // Window glass shows a slowly drifting sky, with a patch of sunlight on the floor
        const sky = skyTexture();
        const glassMeshes = [];
        model.traverse((o) => { if (o.isMesh && o.name.startsWith('WindowGlass')) glassMeshes.push(o); });
        glassMeshes.forEach((glass, i) => {
            const glassTex = sky.clone();
            glassTex.needsUpdate = true;
            glassTex.repeat.set(0.45, 1);
            glassTex.offset.x = i * 0.5;
            animated.windowSkies.push(glassTex);
            glass.material = new THREE.MeshBasicMaterial({ map: glassTex });

            const bounds = new THREE.Box3().setFromObject(glass);
            const pool = new THREE.Mesh(
                new THREE.PlaneGeometry((bounds.max.x - bounds.min.x) * 1.1, 2.6),
                new THREE.MeshBasicMaterial({ map: glowTex, color: 0xfff3d6, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })
            );
            pool.rotation.x = -Math.PI / 2;
            pool.rotation.z = 0.35;
            pool.position.set((bounds.min.x + bounds.max.x) / 2 + 0.6, 0.015, bounds.max.z + 1.6);
            scene.add(pool);
        });

        // Pendant lamps sway around their group origin; glow and light sit at the bulb
        const lampPivots = [];
        model.traverse((o) => { if (o.name.startsWith('Lamp_')) lampPivots.push(o); });
        lampPivots.forEach((pivot) => {
            let bulbPos = new THREE.Vector3(0, -1.5, 0);
            pivot.traverse((o) => {
                if (o.isMesh && o.name.startsWith('LampBulb')) bulbPos = pivot.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
            });
            const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe2a8, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
            glow.scale.set(0.9, 0.9, 1);
            glow.position.copy(bulbPos).y -= 0.05;
            pivot.add(glow);
            const light = new THREE.PointLight(0xffd7a0, 0.2, 6);
            light.position.copy(bulbPos).y -= 0.12;
            pivot.add(light);
            animated.lamps.push({ pivot, base: pivot.rotation.clone(), phase: Math.random() * Math.PI * 2 });
        });

        // Dust motes drifting through the window light
        const moteCount = 90;
        const motePositions = new Float32Array(moteCount * 3);
        for (let i = 0; i < moteCount; i++) {
            motePositions[i * 3] = (Math.random() - 0.5) * 11;
            motePositions[i * 3 + 1] = 0.5 + Math.random() * 3.6;
            motePositions[i * 3 + 2] = 0.5 + Math.random() * 5;
        }
        const moteGeometry = new THREE.BufferGeometry();
        moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
        const motes = new THREE.Points(moteGeometry, new THREE.PointsMaterial({
            map: glowTex, color: 0xfff1d0, size: 0.06, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        scene.add(motes);
        animated.motes = motes;

        // Lighting
        scene.add(new THREE.HemisphereLight(0xfff4e2, 0xb08356, 0.5));
        scene.add(new THREE.AmbientLight(0xffffff, 0.08));
        const sun = new THREE.DirectionalLight(0xfff0d8, 0.42);
        sun.position.set(-5, 7, 8);
        sun.target.position.set(0.5, 0, 1);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -8;
        sun.shadow.camera.right = 8;
        sun.shadow.camera.top = 6;
        sun.shadow.camera.bottom = -6;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 25;
        sun.shadow.bias = -0.0008;
        scene.add(sun);
        scene.add(sun.target);

        animated.mascot = setupMascot(model);

        return animated;
    }

    // ---------- Mascot ----------

    // Mirrors the page's mascot <img>: its src picks the pose texture and its class
    // ("sleeping" / "awake") picks the breathing or wake-up jolt animation.
    function setupMascot(model) {
        const img = host.querySelector('#mascot');
        const zzz = host.querySelector('#sleepAnimation');
        const imgH = MASCOT_HEIGHT * MASCOT_IMAGE.height / (MASCOT_IMAGE.bottom - MASCOT_IMAGE.top);
        const imgW = imgH * MASCOT_IMAGE.width / MASCOT_IMAGE.height;
        const footY = imgH * (MASCOT_IMAGE.height - MASCOT_IMAGE.bottom) / MASCOT_IMAGE.height;

        const spot = model.getObjectByName('MascotSpot');
        const anchor = new THREE.Group();
        if (spot) spot.getWorldPosition(anchor.position);
        else anchor.position.set(MASCOT_DEFAULT_SPOT.x, 0, MASCOT_DEFAULT_SPOT.z);
        scene.add(anchor);

        // Plane with its origin at the character's feet
        const geometry = new THREE.PlaneGeometry(imgW, imgH);
        geometry.translate(0, imgH / 2 - footY, 0);
        const material = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.05 });
        const figure = new THREE.Mesh(geometry, material);
        figure.castShadow = true;
        figure.visible = false; // until the first pose image has loaded
        figure.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.5 });
        anchor.add(figure);

        // Soft contact shadow on the floor
        const blob = new THREE.Mesh(
            new THREE.PlaneGeometry(MASCOT_HEIGHT * 0.95, MASCOT_HEIGHT * 0.3),
            new THREE.MeshBasicMaterial({
                map: canvasTexture(128, 64, (ctx, w, h) => {
                    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
                    g.addColorStop(0, 'rgba(40,24,12,0.55)');
                    g.addColorStop(1, 'rgba(40,24,12,0)');
                    ctx.setTransform(1, 0, 0, h / w, 0, 0);
                    ctx.fillStyle = g;
                    ctx.fillRect(0, 0, w, w);
                }),
                transparent: true,
                depthWrite: false,
            })
        );
        blob.rotation.x = -Math.PI / 2;
        blob.position.y = 0.018;
        anchor.add(blob);

        const loader = new THREE.TextureLoader();
        const textures = new Map();
        const mascot = { img, zzz, anchor, figure, jolt: -1, src: null, sleeping: false, imgW, imgH, footY };

        function sync() {
            const src = img.getAttribute('src');
            if (src !== mascot.src) {
                mascot.src = src;
                if (!textures.has(src)) textures.set(src, loader.load(src, () => applyTexture()));
                applyTexture();
            }
            const sleeping = img.classList.contains('sleeping');
            if (!sleeping && img.classList.contains('awake') && mascot.sleeping !== false) mascot.jolt = performance.now() / 1000;
            mascot.sleeping = sleeping;
        }
        function applyTexture() {
            const tex = textures.get(mascot.src);
            if (!tex || !tex.image) return; // keep the previous pose until the new one loads
            tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
            material.map = tex;
            figure.customDepthMaterial.map = tex;
            figure.visible = true;
            material.needsUpdate = true;
            figure.customDepthMaterial.needsUpdate = true;
        }
        mascot.observer = new MutationObserver(sync);
        mascot.observer.observe(img, { attributes: true, attributeFilter: ['src', 'class'] });
        mascot.sleeping = null;
        sync();
        return mascot;
    }

    const lerp = (a, b, f) => a + (b - a) * f;

    function updateMascot(t, motion) {
        const m = world.mascot;

        // Turn to face the camera around the vertical axis only, so the feet stay planted
        m.figure.rotation.y = Math.atan2(camera.position.x - m.anchor.position.x, camera.position.z - m.anchor.position.z);

        // Same motion as the flat mascot's sleepBreath / wakeJolt CSS animations
        let sx = 1;
        let sy = 1;
        let lift = 0;
        const joltT = (t - m.jolt) / 0.5;
        if (motion && joltT >= 0 && joltT < 1) {
            const s = joltT < 0.5 ? lerp(0.92, 1.08, joltT * 2) : lerp(1.08, 1, joltT * 2 - 1);
            sx = sy = s;
            lift = joltT < 0.5 ? lerp(0, 0.035, joltT * 2) : lerp(0.035, 0, joltT * 2 - 1);
        } else if (motion && m.sleeping) {
            const b = (1 - Math.cos((t * Math.PI * 2) / 4)) / 2;
            sx = 1 + 0.02 * b;
            sy = 1 + 0.01 * b;
            lift = 0.02 * b * MASCOT_HEIGHT;
        }
        m.figure.scale.set(sx, sy, 1);
        m.figure.position.y = lift;

        // Float the page's Zzz from the 3D mascot's head, scaled to its on-screen size
        m.figure.updateMatrixWorld();
        const rect = canvas.getBoundingClientRect();
        const toScreen = (x, y) => {
            const v = m.figure.localToWorld(new THREE.Vector3(x, y, 0)).project(camera);
            return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height };
        };
        const head = toScreen((MASCOT_ZZZ_POINT.u - 0.5) * m.imgW, (1 - MASCOT_ZZZ_POINT.v) * m.imgH - m.footY);
        const top = toScreen(0, MASCOT_HEIGHT);
        const feet = toScreen(0, 0);
        const scale = (feet.y - top.y) / (FLAT_MASCOT_SCREEN_HEIGHT * rect.height);
        const box = m.zzz.offsetHeight;
        m.zzz.style.transform = `translate(${head.x}px, ${head.y - box}px) scale(${scale})`;
    }

    // ---------- Runtime ----------

    const CAMERA_BASE = { x: 0.35, y: 2.0, z: 8.4 };
    const CAMERA_TARGET = { x: 0.45, y: 1.5, z: 0 };
    const BASE_FOV = 40;
    const MIN_HALF_WIDTH = 3.8; // keep the chalkboard in view on narrow screens

    function resize() {
        if (!renderer || !canvas) return;
        const w = canvas.clientWidth || window.innerWidth;
        const h = canvas.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        const aspect = w / h;
        const dist = CAMERA_BASE.z - CAMERA_TARGET.z;
        const neededFov = (2 * Math.atan(MIN_HALF_WIDTH / dist / aspect) * 180) / Math.PI;
        camera.aspect = aspect;
        camera.fov = Math.min(70, Math.max(BASE_FOV, neededFov));
        camera.updateProjectionMatrix();
    }

    function tick(now) {
        frameId = requestAnimationFrame(tick);
        const t = now / 1000;
        const dt = Math.min(0.05, lastTime ? t - lastTime : 0);
        lastTime = t;

        const motion = reducedMotion ? 0 : 1;
        pointer.x += (pointer.tx - pointer.x) * 0.03;
        pointer.y += (pointer.ty - pointer.y) * 0.03;
        camera.position.set(
            CAMERA_BASE.x + motion * (Math.sin(t * 0.07) * 0.25 + pointer.x * 0.35),
            CAMERA_BASE.y + motion * (Math.sin(t * 0.11) * 0.05 - pointer.y * 0.15),
            CAMERA_BASE.z
        );
        camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);

        if (motion) {
            world.lamps.forEach(({ pivot, base, phase }) => {
                pivot.rotation.z = base.z + Math.sin(t * 0.6 + phase) * 0.02;
                pivot.rotation.x = base.x + Math.sin(t * 0.45 + phase) * 0.012;
            });
            if (world.globe) world.globe.rotation.y += dt * 0.25;
            world.windowSkies.forEach((tex) => { tex.offset.x += dt * 0.004; });
            const pos = world.motes.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
                let y = pos.getY(i) + dt * 0.04;
                if (y > 4.2) y = 0.4;
                pos.setY(i, y);
                pos.setX(i, pos.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.02);
            }
            pos.needsUpdate = true;
        }

        updateMascot(t, motion);
        renderer.render(scene, camera);
    }

    function init(container) {
        host = container;
        canvas = document.createElement('canvas');
        canvas.className = 'scene-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        container.insertBefore(canvas, container.firstChild);

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.1, 60);

        window.addEventListener('resize', resize);
        window.addEventListener('pointermove', (e) => {
            pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
            pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
        });
    }

    // Show the 3D scene built from `modelSrc` (a .glb), loading it first if needed
    async function start(container, modelSrc) {
        active = true;
        requestedModel = modelSrc;
        try {
            if (modelSrc !== currentModel) {
                // Show the 2D placeholder while the new model loads
                if (canvas) canvas.classList.remove('visible');
                if (host) host.classList.remove('scene-3d-active');
                await loadThree();
                const gltf = await loadModel(modelSrc);
                if (requestedModel !== modelSrc) return; // a newer scene was picked meanwhile
                if (!renderer) init(container);
                if (world) world.mascot.observer.disconnect();
                world = buildScene(gltf);
                currentModel = modelSrc;
            }
            if (!active) return;
        } catch (e) {
            console.warn('3D scene unavailable, using flat background.', e);
            return;
        }
        resize();
        if (frameId === null) {
            lastTime = 0;
            frameId = requestAnimationFrame(tick);
        }
        requestAnimationFrame(() => {
            canvas.classList.add('visible');
            // Swap the flat mascot for the one in the room
            host.classList.add('scene-3d-active');
        });
    }

    function stop() {
        active = false;
        if (frameId !== null) {
            cancelAnimationFrame(frameId);
            frameId = null;
        }
        if (canvas) canvas.classList.remove('visible');
        if (host) host.classList.remove('scene-3d-active');
        if (world) world.mascot.zzz.style.transform = '';
    }

    window.Classroom3D = { start, stop };
})();
