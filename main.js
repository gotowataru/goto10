import * as THREE from 'three';

// ----- Ammo.js の非同期読み込みと初期化 -----
async function loadAmmo() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = './libs/ammo.wasm.js';
        script.onload = () => {
            if (typeof Ammo === 'function') {
                Ammo().then((AmmoLib) => {
                    document.getElementById('loading').style.display = 'none';
                    console.log("Ammo.js initialized successfully.");
                    resolve(AmmoLib);
                }).catch(reject);
            } else {
                reject(new Error("Ammo function not found after script load. Is ammo.wasm.js correct?"));
            }
        };
        script.onerror = (error) => {
            console.error("Failed to load ammo.wasm.js script.", error);
            document.getElementById('loading').innerText = 'ローカルからの Ammo.js の読み込みに失敗しました。';
            reject(error);
        }
        document.body.appendChild(script);
    });
}

// ----- グローバル変数 -----
let scene, camera, renderer, ground; // sphere 変数は不要に (都度生成のため)
let physicsWorld, rigidBodies = [], tmpTransform; // rigidBodies は生成された球を保持
// let sphereBody; // 特定の球を指す変数は不要に
let AmmoInstance; // Ammo ライブラリ本体を格納

// ----- 初期化処理 -----
loadAmmo().then((AmmoLib) => {
    AmmoInstance = AmmoLib;
    initPhysics();
}).catch(error => {
    console.error("Error during Ammo initialization or Physics setup:", error);
    const loadingElement = document.getElementById('loading');
    if(loadingElement) {
        loadingElement.innerText = '物理エンジンの初期化に失敗しました。コンソールを確認してください。';
        loadingElement.style.display = 'block';
    }
});

// ----- 物理エンジンの初期化 -----
function initPhysics() {
    tmpTransform = new AmmoInstance.btTransform();
    const collisionConfiguration = new AmmoInstance.btDefaultCollisionConfiguration();
    const dispatcher = new AmmoInstance.btCollisionDispatcher(collisionConfiguration);
    const overlappingPairCache = new AmmoInstance.btDbvtBroadphase();
    const solver = new AmmoInstance.btSequentialImpulseConstraintSolver();
    physicsWorld = new AmmoInstance.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collisionConfiguration);
    physicsWorld.setGravity(new AmmoInstance.btVector3(0, -9.8, 0));
    initThreeJS();
}

// ----- Three.js の初期化 -----
function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeeeeee);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    // カメラ位置を少し上から見下ろすように調整すると良いかも
    camera.position.set(0, 10, 15);
    camera.lookAt(0, 0, 0); // 原点付近を見る
    renderer = new THREE.WebGLRenderer({
        canvas: document.querySelector('#myCanvas'),
        antialias: true
    });
    renderer.setSize(window.innerWidth * 0.8, window.innerHeight * 0.8);
    renderer.shadowMap.enabled = true;

    // ----- ライト -----
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // 少し明るく
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9); // 少し強く
    directionalLight.position.set(5, 15, 7.5); // 少し高く
    directionalLight.castShadow = true;
    // 影の解像度や範囲を調整 (任意)
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -15;
    directionalLight.shadow.camera.right = 15;
    directionalLight.shadow.camera.top = 15;
    directionalLight.shadow.camera.bottom = -15;
    scene.add(directionalLight);

    // ----- オブジェクトと物理ボディの作成 -----
    // 1. 地面
    const groundSize = { width: 25, height: 0.5, depth: 25 }; // 少し広く
    const groundGeometry = new THREE.BoxGeometry(groundSize.width, groundSize.height, groundSize.depth);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.9 }); // 色変更
    ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.position.y = -groundSize.height / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const groundShape = new AmmoInstance.btBoxShape(new AmmoInstance.btVector3(groundSize.width * 0.5, groundSize.height * 0.5, groundSize.depth * 0.5));
    const groundTransform = new AmmoInstance.btTransform();
    groundTransform.setIdentity();
    groundTransform.setOrigin(new AmmoInstance.btVector3(0, ground.position.y, 0));
    const groundMass = 0;
    const localInertia = new AmmoInstance.btVector3(0, 0, 0);
    const motionState = new AmmoInstance.btDefaultMotionState(groundTransform);
    const rbInfo = new AmmoInstance.btRigidBodyConstructionInfo(groundMass, motionState, groundShape, localInertia);
    rbInfo.set_m_restitution(0.7); // 地面の反発は固定
    const groundBody = new AmmoInstance.btRigidBody(rbInfo);
    physicsWorld.addRigidBody(groundBody);
    if (groundBody.getRestitution) console.log("Ground restitution:", groundBody.getRestitution());

    // ★★★ 初期状態では球体は生成しない ★★★

    // アニメーションループ開始
    const clock = new THREE.Clock();
    animate(clock);

    // イベントリスナー追加
    addEventListeners();
}

// ----- アニメーションループ -----
function animate(clock) {
    requestAnimationFrame(() => animate(clock));
    const deltaTime = clock.getDelta();

    // 物理シミュレーションを進める
    if (physicsWorld) {
        // deltaTime が大きすぎる場合 (タブが非アクティブだったなど) は調整
        const clampedDeltaTime = Math.min(deltaTime, 0.1); // 例: 最大 0.1 秒
        physicsWorld.stepSimulation(clampedDeltaTime, 10); // サブステップは 10 のまま (必要なら増やす)
    }

    // 物理演算結果を Three.js のメッシュに反映 (全ての rigidBodies に対して)
    for (let i = 0; i < rigidBodies.length; i++) {
        const mesh = rigidBodies[i];
        const physicsBody = mesh.userData.physicsBody;
        // physicsBody が存在しない or 無効なケースも考慮 (稀だが)
        if (!physicsBody || !physicsBody.getMotionState) continue;

        const motionState = physicsBody.getMotionState();
        if (motionState) {
            motionState.getWorldTransform(tmpTransform);
            const position = tmpTransform.getOrigin();
            const quaternion = tmpTransform.getRotation();
            mesh.position.set(position.x(), position.y(), position.z());
            mesh.quaternion.set(quaternion.x(), quaternion.y(), quaternion.z(), quaternion.w());
        }
    }

    // レンダリング
    if(renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

// ----- イベントリスナー -----
function addEventListeners() {
    window.addEventListener('keydown', (event) => {
        // ★★★ 物理世界と AmmoInstance の存在を確認 ★★★
        if (!physicsWorld || !AmmoInstance) return;

        if (event.code === 'Space' || event.key === ' ') {
            event.preventDefault();

            // --- ★★★ 新しい球体をランダムに生成する処理 ★★★ ---

            // 1. 生成する数をランダムに決定 (10〜20個)
            const minCount = 10;
            const maxCount = 20;
            const sphereCount = Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;

            console.log(`Creating ${sphereCount} new spheres...`);

            // 2. 生成する球体のパラメータ範囲 (お好みで調整してください)
            const minRadius = 0.2;
            const maxRadius = 0.8;
            const spawnArea = { x: 10, z: 10 }; // 生成XZ範囲
            const spawnHeight = 10; // 生成高さ

            // 3. 決定した数だけループして球体を生成
            for (let i = 0; i < sphereCount; i++) {
                // --- ランダムなプロパティを計算 ---
                const radius = minRadius + Math.random() * (maxRadius - minRadius);
                const color = new THREE.Color(Math.random() * 0xffffff);
                const startPos = new THREE.Vector3(
                    (Math.random() - 0.5) * spawnArea.x,
                    spawnHeight + Math.random() * 2,
                    (Math.random() - 0.5) * spawnArea.z
                );

                // --- Three.js メッシュ作成 ---
                const sphereGeometry = new THREE.SphereGeometry(radius, 16, 8); // セグメント数を減らす
                const sphereMaterial = new THREE.MeshStandardMaterial({
                    color: color,
                    roughness: 0.5,
                    metalness: 0.3
                });
                const mesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
                mesh.position.copy(startPos);
                mesh.castShadow = true;
                scene.add(mesh);

                // --- Ammo.js 物理ボディ作成 ---
                const mass = (4 / 3) * Math.PI * Math.pow(radius, 3); // 半径に応じた質量
                const sphereShape = new AmmoInstance.btSphereShape(radius);
                const transform = new AmmoInstance.btTransform();
                transform.setIdentity();
                const ammoStartPos = new AmmoInstance.btVector3(startPos.x, startPos.y, startPos.z);
                transform.setOrigin(ammoStartPos);
                const localInertia = new AmmoInstance.btVector3(0, 0, 0);
                sphereShape.calculateLocalInertia(mass, localInertia);
                const motionState = new AmmoInstance.btDefaultMotionState(transform);
                const rbInfo = new AmmoInstance.btRigidBodyConstructionInfo(mass, motionState, sphereShape, localInertia);
                rbInfo.set_m_restitution(0.6); // 反発係数 (固定)
                rbInfo.set_m_friction(0.5);    // 摩擦係数 (固定)
                const body = new AmmoInstance.btRigidBody(rbInfo);
                physicsWorld.addRigidBody(body);

                // --- 関連付けとリスト追加 ---
                mesh.userData.physicsBody = body;
                rigidBodies.push(mesh); // グローバル配列に追加

                // --- 一時オブジェクトのメモリ解放 ---
                AmmoInstance.destroy(ammoStartPos);
            }
            // 現在のオブジェクト総数を表示
            console.log(`Total rigid bodies now: ${rigidBodies.length}`);
            if (rigidBodies.length > 200) {
                 console.warn("多くのオブジェクトが生成されています。パフォーマンスに影響が出る可能性があります。");
            }
        }
    });
}

// ----- ウィンドウリサイズ対応 -----
window.addEventListener('resize', () => {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth * 0.8, window.innerHeight * 0.8);
    }
});