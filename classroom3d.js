// 3D classroom background rendered with three.js.
// Recreates background-b.png as a toon-shaded scene with a gently drifting camera.
// three.js is loaded lazily the first time the scene is shown; until it is ready
// (or if WebGL is unavailable) the flat PNG behind the canvas stays visible.
(function () {
    const THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    const CHALKBOARD_SRC = 'chalkboard.jpg';
    const OUTLINE_COLOR = 0x3a2a1f;

    let threeLoading = null;
    let canvas = null;
    let renderer = null;
    let scene = null;
    let camera = null;
    let world = null;
    let frameId = null;
    let active = false;
    let lastTime = 0;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function loadThree() {
        if (window.THREE) return Promise.resolve(window.THREE);
        if (!threeLoading) {
            threeLoading = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = THREE_SRC;
                script.onload = () => resolve(window.THREE);
                script.onerror = () => {
                    threeLoading = null;
                    reject(new Error('Failed to load three.js'));
                };
                document.head.appendChild(script);
            });
        }
        return threeLoading;
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

    function wallTexture(widthM, heightM, highlight) {
        const s = 96;
        return canvasTexture(Math.round(widthM * s), Math.round(heightM * s), (ctx, w, h) => {
            const y = (m) => h - m * s;
            ctx.fillStyle = '#f2dcb9';
            ctx.fillRect(0, 0, w, h);
            if (highlight) {
                ctx.fillStyle = '#f5e4c8';
                ctx.beginPath();
                ctx.ellipse(w * highlight, h * 0.98, w * 0.3, h * 0.8, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            // Lower wainscot, light stripe and baseboard
            ctx.fillStyle = '#eed2a9';
            ctx.fillRect(0, y(1.25), w, 1.25 * s);
            ctx.fillStyle = '#f8e9cf';
            ctx.fillRect(0, y(1.38), w, 0.13 * s);
            ctx.fillStyle = '#ddbb8f';
            ctx.fillRect(0, y(1.38), w, 2);
            ctx.fillRect(0, y(1.25), w, 2);
        });
    }

    function floorTexture() {
        const tex = canvasTexture(1024, 1024, (ctx, w, h) => {
            const rows = 20;
            const rowH = h / rows;
            for (let r = 0; r < rows; r++) {
                let x = -Math.random() * 400;
                while (x < w) {
                    const len = 300 + Math.random() * 420;
                    const shade = Math.random() * 18 - 9;
                    ctx.fillStyle = `rgb(${201 + shade}, ${146 + shade}, ${88 + shade * 0.6})`;
                    ctx.fillRect(x, r * rowH, len, rowH);
                    // Grain
                    ctx.strokeStyle = 'rgba(120, 72, 34, 0.18)';
                    ctx.lineWidth = 1.5;
                    for (let g = 0; g < 3; g++) {
                        const gy = r * rowH + 8 + Math.random() * (rowH - 16);
                        const gx = x + Math.random() * len * 0.5;
                        ctx.beginPath();
                        ctx.moveTo(gx, gy);
                        ctx.quadraticCurveTo(gx + 60, gy + (Math.random() * 6 - 3), gx + 60 + Math.random() * 120, gy);
                        ctx.stroke();
                    }
                    // Plank seam
                    ctx.fillStyle = '#7d5230';
                    ctx.fillRect(x, r * rowH, 2.5, rowH);
                    x += len;
                }
                ctx.fillStyle = '#7d5230';
                ctx.fillRect(0, r * rowH, w, 2.5);
            }
        });
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
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

    // Chalkboard art lives in chalkboard.jpg. Pages opened via file:// can't upload
    // local images to WebGL, so the board stays plain green in that case.
    function applyChalkboardTexture(material) {
        const img = new Image();
        img.onload = () => {
            try {
                const probe = document.createElement('canvas').getContext('2d');
                probe.drawImage(img, 0, 0, 1, 1);
                probe.getImageData(0, 0, 1, 1);
            } catch (e) {
                return;
            }
            const tex = new THREE.Texture(img);
            tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
            tex.needsUpdate = true;
            material.map = tex;
            material.color.set(0xffffff);
            material.needsUpdate = true;
        };
        img.src = CHALKBOARD_SRC;
    }

    function rugTexture() {
        return canvasTexture(1400, 660, (ctx, w, h) => {
            const pad = 10;
            const radius = 46;
            const bands = ['#e1483f', '#f3c331', '#41a34f', '#3f6fd0', '#8a50b9'];
            ctx.save();
            roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, radius);
            ctx.clip();
            const bandH = (h - pad * 2) / bands.length;
            bands.forEach((color, i) => {
                ctx.fillStyle = color;
                ctx.fillRect(0, pad + i * bandH, w, bandH + 1);
                // Soft woven highlight
                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                ctx.fillRect(0, pad + i * bandH, w, bandH * 0.35);
            });
            ctx.strokeStyle = '#2b2222';
            ctx.lineWidth = 3;
            for (let i = 1; i < bands.length; i++) {
                ctx.beginPath();
                ctx.moveTo(0, pad + i * bandH);
                ctx.lineTo(w, pad + i * bandH);
                ctx.stroke();
            }
            const cols = 7;
            for (let i = 1; i < cols; i++) {
                const x = pad + (i * (w - pad * 2)) / cols;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h);
                ctx.stroke();
            }
            ctx.restore();
            ctx.strokeStyle = '#2b2222';
            ctx.lineWidth = 8;
            roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, radius);
            ctx.stroke();
        });
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function globeTexture() {
        return canvasTexture(512, 256, (ctx, w, h) => {
            ctx.fillStyle = '#3d8fd6';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#5fb55a';
            const continents = [[90, 90, 50, 40], [130, 170, 30, 50], [260, 80, 45, 30], [280, 150, 35, 55], [400, 100, 60, 35], [430, 190, 30, 20]];
            continents.forEach(([x, y, rx, ry]) => {
                for (let i = 0; i < 4; i++) {
                    ctx.beginPath();
                    ctx.ellipse(x + (Math.random() - 0.5) * rx, y + (Math.random() - 0.5) * ry, rx * 0.6, ry * 0.6, Math.random(), 0, Math.PI * 2);
                    ctx.fill();
                }
            });
            ctx.fillStyle = '#eef6ff';
            ctx.fillRect(0, 0, w, 14);
            ctx.fillRect(0, h - 14, w, 14);
        });
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

    // ---------- Scene building ----------

    function buildScene() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf2dcb9);

        const gradientMap = new THREE.DataTexture(new Uint8Array([120, 195, 255]), 3, 1, THREE.LuminanceFormat);
        gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
        gradientMap.generateMipmaps = false;
        gradientMap.needsUpdate = true;

        const lineMaterial = new THREE.LineBasicMaterial({ color: OUTLINE_COLOR });
        const toon = (color, extra) => new THREE.MeshToonMaterial(Object.assign({ color, gradientMap }, extra));

        const animated = { lamps: [], globe: null, sky: null, motes: null };

        function addMesh(parent, geometry, material, position, opts) {
            opts = opts || {};
            const mesh = new THREE.Mesh(geometry, material);
            if (position) mesh.position.set(position[0], position[1], position[2]);
            mesh.castShadow = opts.castShadow !== false;
            mesh.receiveShadow = opts.receiveShadow !== false;
            if (opts.outline !== false) {
                mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), lineMaterial));
            }
            parent.add(mesh);
            return mesh;
        }

        function box(parent, w, h, d, color, x, y, z, opts) {
            const material = color instanceof THREE.Material ? color : toon(color);
            return addMesh(parent, new THREE.BoxGeometry(w, h, d), material, [x, y, z], opts);
        }

        const ROOM_H = 4.7;
        const SPLIT_X = -2.9; // where the left wall section steps forward
        const LEFT_DEPTH = 1.2;

        // Floor
        const floorTex = floorTexture();
        floorTex.repeat.set(24 / 4, 16 / 4);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 16), toon(0xffffff, { map: floorTex }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0, 0, 7);
        floor.receiveShadow = true;
        scene.add(floor);

        // Ceiling
        const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(24, 16), toon(0xead3ad));
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(0, ROOM_H, 7);
        scene.add(ceiling);

        // Back wall (behind chalkboard)
        const backW = 13.9;
        const backWall = new THREE.Mesh(
            new THREE.PlaneGeometry(backW, ROOM_H),
            toon(0xffffff, { map: wallTexture(backW, ROOM_H, 0.3) })
        );
        backWall.position.set(SPLIT_X + backW / 2, ROOM_H / 2, 0);
        backWall.receiveShadow = true;
        scene.add(backWall);

        // Left wall section, stepped forward, with its own side face
        const leftW = 8.1;
        const leftMats = [
            toon(0xffffff, { map: wallTexture(LEFT_DEPTH, ROOM_H) }), // +x side face
            toon(0xf2dcb9), toon(0xf2dcb9), toon(0xf2dcb9),
            toon(0xffffff, { map: wallTexture(leftW, ROOM_H, 0.6) }), // front face
            toon(0xf2dcb9),
        ];
        const leftBlock = new THREE.Mesh(new THREE.BoxGeometry(leftW, ROOM_H, LEFT_DEPTH), leftMats);
        leftBlock.position.set(SPLIT_X - leftW / 2, ROOM_H / 2, LEFT_DEPTH / 2);
        leftBlock.receiveShadow = true;
        scene.add(leftBlock);
        const corner = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(SPLIT_X, 0, LEFT_DEPTH), new THREE.Vector3(SPLIT_X, ROOM_H, LEFT_DEPTH),
            new THREE.Vector3(SPLIT_X, 0, 0), new THREE.Vector3(SPLIT_X, ROOM_H, 0),
        ]);
        scene.add(new THREE.LineSegments(corner, lineMaterial));

        // Right wall, mostly off-screen on wide displays
        const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(16, ROOM_H), toon(0xf0d8b3));
        rightWall.rotation.y = -Math.PI / 2;
        rightWall.position.set(SPLIT_X + backW, ROOM_H / 2, 7);
        scene.add(rightWall);

        // Baseboards
        const baseColor = toon(0xae794a);
        box(scene, backW - 0.04, 0.12, 0.04, baseColor, SPLIT_X + 0.04 + (backW - 0.04) / 2, 0.06, 0.02);
        box(scene, leftW, 0.12, 0.04, baseColor, SPLIT_X - leftW / 2, 0.06, LEFT_DEPTH + 0.02);
        box(scene, 0.04, 0.12, LEFT_DEPTH, baseColor, SPLIT_X + 0.02, 0.06, LEFT_DEPTH / 2);

        // Windows
        const sky = skyTexture();
        animated.sky = sky;
        buildWindow(-4.05, LEFT_DEPTH, 0);
        buildWindow(4.15, 0, 0.5);

        function buildWindow(cx, wallZ, skyOffset) {
            const w = 1.4;
            const h = 3.3;
            const bottom = 0.78;
            const group = new THREE.Group();
            group.position.set(cx, bottom + h / 2, wallZ);
            scene.add(group);

            const glassTex = sky.clone();
            glassTex.needsUpdate = true;
            glassTex.repeat.set(0.45, 1);
            glassTex.offset.x = skyOffset;
            animated.windowSkies = animated.windowSkies || [];
            animated.windowSkies.push(glassTex);
            const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: glassTex }));
            glass.position.z = 0.005;
            group.add(glass);

            const frame = toon(0xfbf8f1);
            const noShadow = { castShadow: false };
            const t = 0.1;
            const d = 0.09;
            box(group, w + t, t, d, frame, 0, h / 2, d / 2, noShadow);
            box(group, w + t, t, d, frame, 0, -h / 2, d / 2, noShadow);
            box(group, t, h + t, d, frame, -w / 2, 0, d / 2, noShadow);
            box(group, t, h + t, d, frame, w / 2, 0, d / 2, noShadow);
            box(group, 0.05, h, 0.06, frame, 0, 0, 0.03, noShadow);
            for (let i = 1; i < 6; i++) {
                box(group, w, 0.05, 0.06, frame, 0, -h / 2 + (i * h) / 6, 0.03, noShadow);
            }
            box(group, w + 0.3, 0.07, 0.2, frame, 0, -h / 2 - 0.06, 0.1, noShadow);

            // Sunlight pool on the floor
            const pool = new THREE.Mesh(
                new THREE.PlaneGeometry(w * 1.1, 2.6),
                new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xfff3d6, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })
            );
            pool.rotation.x = -Math.PI / 2;
            pool.rotation.z = 0.35;
            pool.position.set(cx + 0.6, 0.015, wallZ + 1.6);
            scene.add(pool);
        }

        // Chalkboard
        const board = new THREE.Group();
        board.position.set(0.72, 1.78, 0);
        scene.add(board);
        const wood = toon(0x9e6a3d);
        const bw = 4.8;
        const bh = 2.05;
        box(board, bw, bh, 0.08, wood, 0, 0, 0.04);
        const boardMaterial = new THREE.MeshLambertMaterial({ color: 0x2f5b38 });
        applyChalkboardTexture(boardMaterial);
        const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(bw - 0.2, bh - 0.2), boardMaterial);
        boardFace.position.z = 0.085;
        boardFace.receiveShadow = true;
        board.add(boardFace);
        box(board, bw + 0.04, 0.05, 0.16, wood, 0, -bh / 2 - 0.01, 0.1);
        box(board, 0.26, 0.06, 0.08, 0x3b3b3b, -2.0, -bh / 2 + 0.045, 0.12);
        box(board, 0.24, 0.05, 0.07, 0xe0c58f, 1.75, -bh / 2 + 0.04, 0.12);
        [[-1.35, 0x9fd0f0], [-0.75, 0xffffff], [1.45, 0xf7f3e8]].forEach(([x, color]) => {
            const chalkStick = addMesh(board, new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8), toon(color), [x, -bh / 2 + 0.03, 0.12]);
            chalkStick.rotation.z = Math.PI / 2;
        });

        // Pendant lamps
        const glowTex = glowTexture();
        [[-1.0, 2.6], [2.25, 2.6]].forEach(([x, z]) => {
            const pivot = new THREE.Group();
            pivot.position.set(x, ROOM_H, z);
            scene.add(pivot);
            const cordLen = 1.15;
            addMesh(pivot, new THREE.CylinderGeometry(0.012, 0.012, cordLen, 6), toon(0x1e1e1e), [0, -cordLen / 2, 0], { outline: false });
            addMesh(pivot, new THREE.CylinderGeometry(0.06, 0.06, 0.1, 16), toon(0x262626), [0, -cordLen - 0.03, 0]);
            addMesh(
                pivot,
                new THREE.CylinderGeometry(0.07, 0.34, 0.3, 32, 1, true),
                toon(0x2a2a2a, { side: THREE.DoubleSide }),
                [0, -cordLen - 0.2, 0],
                { outline: false }
            );
            addMesh(pivot, new THREE.SphereGeometry(0.075, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6dc }), [0, -cordLen - 0.33, 0], { outline: false, castShadow: false });
            const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe2a8, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
            glow.scale.set(0.9, 0.9, 1);
            glow.position.y = -cordLen - 0.38;
            pivot.add(glow);
            const light = new THREE.PointLight(0xffd7a0, 0.2, 6);
            light.position.y = -cordLen - 0.45;
            pivot.add(light);
            animated.lamps.push({ pivot, phase: Math.random() * Math.PI * 2 });
        });

        // Bookshelf
        const shelf = new THREE.Group();
        shelf.position.set(-2.15, 0, 0.25); // back sits just in front of the baseboard
        scene.add(shelf);
        const shelfWood = toon(0x9a6337);
        const sw = 1.25;
        const sh = 1.08;
        const sd = 0.4;
        box(shelf, 0.05, sh, sd, shelfWood, -sw / 2, sh / 2, 0);
        box(shelf, 0.05, sh, sd, shelfWood, sw / 2, sh / 2, 0);
        box(shelf, sw + 0.06, 0.05, sd + 0.02, shelfWood, 0, sh, 0);
        // Inner boards fit between the side panels so no faces are coplanar (z-fighting)
        const innerW = sw - 0.05;
        box(shelf, innerW, 0.06, sd, shelfWood, 0, 0.03, 0);
        box(shelf, innerW, 0.03, sd, shelfWood, 0, sh / 3 + 0.02, 0);
        box(shelf, innerW, 0.03, sd, shelfWood, 0, (2 * sh) / 3 + 0.01, 0);
        box(shelf, innerW, sh - 0.06, 0.02, toon(0x6e4426), 0, sh / 2, -sd / 2 + 0.01, { outline: false });

        // Books fill each shelf up to `end`, staying clear of the boards and the props
        const bookColors = [0xd9534f, 0x3f7fd1, 0xf0c03a, 0x4fae5b, 0x8a56b8, 0xe9893c, 0x2f9c9a, 0xcf4f86];
        const shelfLevels = [
            { baseY: 0.06, clearance: 0.305, end: sw / 2 - 0.44 },
            { baseY: sh / 3 + 0.035, clearance: 0.32, end: sw / 2 - 0.44 },
            { baseY: (2 * sh) / 3 + 0.025, clearance: 0.31, end: sw / 2 - 0.035 },
        ];
        shelfLevels.forEach(({ baseY, clearance, end }, level) => {
            let x = -sw / 2 + 0.035;
            for (;;) {
                const bwid = 0.045 + Math.random() * 0.035;
                if (x + bwid > end) break;
                const bhgt = Math.min(0.22 + Math.random() * 0.09, clearance - 0.02);
                box(shelf, bwid, bhgt, 0.26, bookColors[Math.floor(Math.random() * bookColors.length)], x + bwid / 2, baseY + bhgt / 2 + 0.001, 0.02);
                x += bwid + 0.006;
            }
            if (level === 0) {
                // Lying stack plus a little teddy
                box(shelf, 0.34, 0.05, 0.24, 0x4fae5b, sw / 2 - 0.25, baseY + 0.025, 0.03);
                box(shelf, 0.3, 0.05, 0.22, 0xd9534f, sw / 2 - 0.25, baseY + 0.075, 0.03);
            }
            if (level === 1) {
                addMesh(shelf, new THREE.SphereGeometry(0.07, 16, 12), toon(0xc98b4f), [sw / 2 - 0.25, baseY + 0.07, 0.05]);
                addMesh(shelf, new THREE.SphereGeometry(0.05, 16, 12), toon(0xc98b4f), [sw / 2 - 0.25, baseY + 0.17, 0.05]);
                box(shelf, 0.12, 0.07, 0.1, 0xd9534f, sw / 2 - 0.1, baseY + 0.035, 0.05);
            }
        });

        // Globe on the shelf
        const globeGroup = new THREE.Group();
        globeGroup.position.set(-2.12, sh, 0.25);
        scene.add(globeGroup);
        addMesh(globeGroup, new THREE.CylinderGeometry(0.09, 0.11, 0.04, 20), toon(0x8a5a32), [0, 0.02, 0]);
        addMesh(globeGroup, new THREE.CylinderGeometry(0.015, 0.015, 0.1, 8), toon(0x8a5a32), [0, 0.08, 0], { outline: false });
        const tilt = new THREE.Group();
        tilt.position.y = 0.3;
        tilt.rotation.z = 0.4;
        globeGroup.add(tilt);
        const globe = addMesh(tilt, new THREE.SphereGeometry(0.17, 32, 24), toon(0xffffff, { map: globeTexture() }), [0, 0, 0], { outline: false });
        const ring = addMesh(tilt, new THREE.TorusGeometry(0.2, 0.012, 8, 40, Math.PI * 1.3), toon(0x8a5a32), [0, 0, 0], { outline: false });
        ring.rotation.z = -Math.PI * 0.65;
        animated.globe = globe;

        // Teacher desk
        const desk = new THREE.Group();
        desk.position.set(3.35, 0, 1.7);
        scene.add(desk);
        const deskWood = toon(0xa46c3e);
        const deskDark = toon(0x8c5a32);
        const dw = 2.0;
        const dd = 0.8;
        const dh = 0.78;
        box(desk, dw + 0.1, 0.07, dd + 0.08, deskWood, 0, dh, 0);
        box(desk, 0.08, dh - 0.03, dd, deskDark, -dw / 2 + 0.04, (dh - 0.03) / 2, 0);
        box(desk, 0.08, dh - 0.03, dd, deskDark, dw / 2 - 0.04, (dh - 0.03) / 2, 0);
        box(desk, dw - 0.08, dh - 0.2, 0.04, deskWood, 0, dh - (dh - 0.2) / 2 - 0.03, dd / 2 - 0.04);
        // Wood grain lines on the modesty panel
        const grain = new THREE.BufferGeometry().setFromPoints(
            [0.25, 0.4, 0.55].flatMap((y) => [new THREE.Vector3(-dw / 2 + 0.15, y, dd / 2 - 0.015), new THREE.Vector3(dw / 2 - 0.15, y + 0.02, dd / 2 - 0.015)])
        );
        desk.add(new THREE.LineSegments(grain, new THREE.LineBasicMaterial({ color: 0x6b4325 })));
        // Desk items
        const topY = dh + 0.035;
        box(desk, 0.32, 0.06, 0.22, 0x4f8b5a, -0.6, topY + 0.03, 0.05).rotation.y = 0.15;
        box(desk, 0.36, 0.005, 0.26, 0xfbfbf7, 0.15, topY + 0.003, 0.05, { outline: false }).rotation.y = -0.05;
        box(desk, 0.1, 0.005, 0.1, 0xf6e04a, 0.55, topY + 0.003, 0.15, { outline: false });
        const pencil = box(desk, 0.18, 0.015, 0.015, 0x333333, -0.25, topY + 0.008, 0.12);
        pencil.rotation.y = 0.5;
        addMesh(desk, new THREE.CylinderGeometry(0.06, 0.055, 0.14, 20), toon(0x4f7fc9), [0.8, topY + 0.07, -0.05]);
        [[-0.02, 0x3f7fd1, 0.1], [0.02, 0xd9534f, -0.15], [0, 0xf0c03a, 0]].forEach(([dx, color, rot]) => {
            const p = addMesh(desk, new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), toon(color), [0.8 + dx, topY + 0.15, -0.05], { outline: false });
            p.rotation.z = rot;
        });

        // Chair tucked behind the desk
        const chair = new THREE.Group();
        chair.position.set(2.95, 0, 0.95);
        scene.add(chair);
        const chairWood = toon(0x8f5a31);
        box(chair, 0.5, 0.05, 0.46, chairWood, 0, 0.48, 0);
        // Backrest panel sits between the posts, which run up to its top edge
        box(chair, 0.38, 0.3, 0.04, chairWood, 0, 1.12, -0.22);
        box(chair, 0.05, 0.79, 0.05, chairWood, -0.22, 0.875, -0.22);
        box(chair, 0.05, 0.79, 0.05, chairWood, 0.22, 0.875, -0.22);
        [[-0.22, 0.2], [0.22, 0.2], [-0.22, -0.2], [0.22, -0.2]].forEach(([x, z]) => box(chair, 0.05, 0.47, 0.05, chairWood, x, 0.235, z));

        // Rainbow rug
        const rugTex = rugTexture();
        const rug = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.55), toon(0xffffff, { map: rugTex, transparent: true, alphaTest: 0.5 }));
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(0.3, 0.012, 2.4);
        rug.receiveShadow = true;
        scene.add(rug);

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

        return animated;
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
            world.lamps.forEach(({ pivot, phase }) => {
                pivot.rotation.z = Math.sin(t * 0.6 + phase) * 0.02;
                pivot.rotation.x = Math.sin(t * 0.45 + phase) * 0.012;
            });
            world.globe.rotation.y += dt * 0.25;
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

        renderer.render(scene, camera);
    }

    function init(container) {
        canvas = document.createElement('canvas');
        canvas.className = 'scene-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        container.insertBefore(canvas, container.firstChild);

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.1, 60);
        world = buildScene();

        window.addEventListener('resize', resize);
        window.addEventListener('pointermove', (e) => {
            pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
            pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
        });
    }

    async function start(container) {
        active = true;
        try {
            await loadThree();
            if (!active) return;
            if (!renderer) init(container);
        } catch (e) {
            console.warn('3D classroom unavailable, using flat background.', e);
            return;
        }
        resize();
        if (frameId === null) {
            lastTime = 0;
            frameId = requestAnimationFrame(tick);
        }
        requestAnimationFrame(() => canvas.classList.add('visible'));
    }

    function stop() {
        active = false;
        if (frameId !== null) {
            cancelAnimationFrame(frameId);
            frameId = null;
        }
        if (canvas) canvas.classList.remove('visible');
    }

    window.Classroom3D = { start, stop };
})();
