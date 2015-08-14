(function() {
  /*global THREE, TWEEN, Marathon */
  var scene = new THREE.Scene(),
    renderer = new THREE.WebGLRenderer(),
    geometry = new THREE.Geometry(),
    container = document.getElementById("content"),
    camera,
    cameraControls,
    cameraPositions = [
      {x: 2000, y: -3200, z: 4500}, // start, "dawn on earth"
      {x: -1850, y: 5500, z: -50}, // event horizon
      {x: 0, y: 0, z: 12000}, // eye of sauron
      {x: 0, y: 0, z: 3500} // end, zoomed in upfront
    ],
    flyCamera = false,
    cameraIsMoving = false,
    viewportHeight = window.innerHeight,
    viewportWidth = window.innerWidth,
    jed = toJED(new Date()),
    maxParticles = 100000,
    particlesPointers = [],
    initialParticles = [],
    added_objects = [],
    particleSystem,
    particleAttributes,
    particleUniforms,
    taskIdLookupTable = {},
    particleTexture = THREE.ImageUtils.loadTexture("./img/particle.png"),
    stagingColor = new THREE.Color(0xcccccc),
    colorScheme = {
      "uranus": new THREE.Color(0x48B978), // green
      "heliotrope": new THREE.Color(0x7F32DE), // purple
      "mercury": new THREE.Color(0xE82A78), // magenta
      "neptune": new THREE.Color(0x20D5FF) // cyan
      //"venus": new THREE.Color(0xF4B826), // yellow
      //"earth": new THREE.Color(0x2F81F7) // blue
    },
    pointCloudRadiusMin = 500,
    pointCloudRadiusMax = 10000,
    animationDirections = {
      alpha: []
    },
    hudElements = {
      totalInstancesCounter: document.getElementById("total-instances"),
      totalStagedCounter: document.getElementById("total-staged"),
      individualAppCounters: [],
      individualAppToggles: [],
      individualAppLabels: [],
      toggleGrouped: document.getElementById("group-radius"),
      toggleUngrouped: document.getElementById("ungroup-radius"),
      toggleFlyCam: document.getElementById("toggle-fly-cam"),
      loading: document.getElementById("loading")
    },
    easeAlpha = 0.05,
    ease = 0.1,
    appIds = [],
    individualAppCounters = [],
    maxApps = Object.keys(colorScheme).length,
    totalStagedCounter = 0,
    isToggleGroupedActive = false,
    lastCameraPos = null;

  function createIndividualAppHUDElements() {
    var parent = document.getElementById("hud").firstElementChild;
    for (var i = 1; i < maxApps + 1; i++) {
      var html = `
       <div class="app" id="app-${i}">
         <div class="switch">
           <input id="toggle-app-${i}" data-index="${i}" class="cmn-toggle" type="checkbox" checked>
           <label for="toggle-app-${i}"></label>
         </div>
         <div class="info">
           <p id="app-${i}-instances" class="big-number" data-value="0">0</p>
           <p class="label" id="app-${i}-label">n/a</p>
         </div>
       </div>`;
      parent.insertAdjacentHTML("beforeend", html);
      // Save DOM refs
      hudElements.individualAppCounters.push(
        document.getElementById("app-" + i + "-instances")
      );
      hudElements.individualAppToggles.push(
        document.getElementById("toggle-app-" + i )
      );
      hudElements.individualAppLabels.push(
        document.getElementById("app-" + i + "-label")
      );
      individualAppCounters[i - 1] = 0;
    }
  }

  function toggleFlyCam() {
    TWEEN.removeAll();
    flyCamera = true;
    cameraIsMoving = false;
    cameraControls.enabled = false;
    hudElements.toggleFlyCam.checked = true;
  }

  function toggleManualCam() {
    TWEEN.removeAll();
    flyCamera = false;
    cameraIsMoving = false;
    cameraControls.enabled = true;
    hudElements.toggleFlyCam.checked = false;
  }

  function doBindings() {
    // Toggle grouped apps view
    hudElements.toggleGrouped.addEventListener("click", function (e) {
      e.preventDefault();
      isToggleGroupedActive = true;
      initialParticles.forEach(function (p) {
        p.transitionEnd.groupedRadius = false;
        p.transitionEnd.initialRadius = true;
      });
      hudElements.toggleGrouped.className = "active";
      hudElements.toggleUngrouped.className = "";
    });

    // Toggle ungrouped apps view
    hudElements.toggleUngrouped.addEventListener("click", function (e) {
      e.preventDefault();
      isToggleGroupedActive = false;
      initialParticles.forEach(function (p) {
        p.transitionEnd.initialRadius = false;
        p.transitionEnd.groupedRadius = true;
      });
      hudElements.toggleGrouped.className = "";
      hudElements.toggleUngrouped.className = "active";
    });

    // Auto-disengage flycam on mouse click/drag
    container.childNodes[0].addEventListener("mousedown", function (e) {
      toggleManualCam();
    });

    // Toggle flycam
    hudElements.toggleFlyCam.addEventListener("change", function (e) {
      e.preventDefault();
      if(hudElements.toggleFlyCam.checked) {
        toggleFlyCam();
      } else {
        toggleManualCam();
      }
    });

    // Reset camera to start position
    document.addEventListener("keydown", function (e) {
      if (e.keyCode < 49 || e.keyCode > 57) return;
      var cameraIndex = parseInt(e.keyCode) - 49; // start at 0
      if (cameraIndex < cameraPositions.length) {
        toggleFlyCam();
        cameraIsMoving = true;
        TWEEN.removeAll();
        new TWEEN.Tween(camera.position)
          .to(cameraPositions[cameraIndex], 4000)
          .easing(TWEEN.Easing.Cubic.InOut)
          .onUpdate(function () {
            camera.updateProjectionMatrix();
          })
          .onComplete(function () {
            flyCamera = false;
            cameraIsMoving = false;
            hudElements.toggleFlyCam.checked = false;
            cameraControls.enabled = true;
          })
          .start();
      }
    });

    // App toggles
    hudElements.individualAppToggles.forEach(function (toggle) {
      toggle.addEventListener("change", function (e) {
        var index = parseInt(e.target.dataset.index) - 1;
        var checked = e.target.checked;
        for (var i = 0; i < maxParticles; i++) {
          var p = initialParticles[i];
          if (p.id === index) {
            initialParticles[i].visible = checked;
            initialParticles[i].transitionEnd.alpha = false;
          }
        }
      });
    });
  }

  function setCameraPosition(i) {
    if (cameraPositions[i] === undefined) i = 0;
    camera.position.x = cameraPositions[i].x;
    camera.position.y = cameraPositions[i].y;
    camera.position.z = cameraPositions[i].z;
  }

  function init() {
    // Individual apps HUD
    createIndividualAppHUDElements();

    // Renderer
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(viewportWidth, viewportHeight);
    renderer.setClearColor(0x111111, 1);
    container.appendChild(renderer.domElement);

    // Camera
    var aspectRatio = viewportWidth / viewportHeight;
    camera = new THREE.PerspectiveCamera(90, aspectRatio, 1, 0);
    scene.add(camera);
    setCameraPosition(0);

     //Camera controls
    cameraControls = new THREE.TrackballControls(camera, container);
    cameraControls.staticMoving = true;
    cameraControls.panSpeed = 2;
    cameraControls.zoomSpeed = 3;
    cameraControls.rotateSpeed = 3;
    cameraControls.maxDistance = pointCloudRadiusMax + pointCloudRadiusMin + 2000;
    cameraControls.dynamicDampingFactor = 0.5;

    // Generate total amount of "invisible" particles
    var radiusStep = pointCloudRadiusMax / maxApps;
    for (var i = 0; i < maxParticles; i++) {
      var randomAlpha = Math.random() * (0.9 - 0.7) + 0.7;

      // Ungrouped orbits
      var minR = pointCloudRadiusMin;
      var maxR = pointCloudRadiusMax;
      var radius = maxR + (Math.random() * maxR + minR) - (maxR - minR);

      initialParticles[i] = {
        id: null,
        attributes: {
          phi: Math.random() * 360,
          theta: Math.random() * 1000 - 200,
          radius: 0,
          speed: Math.random() * 5000 + 250,
          value_color: stagingColor,
          value_alpha: 0.0,
          locked: 0
        },
        running: 0,
        targetAlpha: parseFloat(randomAlpha.toFixed(2)),
        targetColor: stagingColor,
        initialRadius: radius,
        groupedRadius: radius,
        transitionEnd: {
          alpha: false,
          initialRadius: true,
          groupedRadius: true
        },
        visible: false
      };
    }

    for (var i = 0; i < maxParticles; i++) {
      // Populate particle index pointers array
      particlesPointers.push(i.toString());
      // Create Orbit3D objects
      var roid = initialParticles[i].attributes;
      var orbit = new Orbit3D(roid, {
        color: 0xffffff,
        display_color: new THREE.Color(0x000000),
        width: 20,
        object_size: 25,
        jed: jed,
        particle_geometry: geometry // will add itself to this geometry
      }, true);

      added_objects.push(orbit);
    }

    // reset date
    jed = toJED(new Date());

    // createParticleSystem
    particleAttributes = {
      phi: {type: "f", value: []},
      theta: {type: "f", value: []},
      radius: {type: "f", value: []},
      speed: {type: "f", value: []},
      size: {type: "f", value: []},
      value_color: {type: "c", value: []},
      value_alpha: {type: "f", value: []}
    };

    particleUniforms = {
      jed: {type: "f", value: jed},
      small_roid_texture: { type: "t", value: particleTexture}
    };

    // Shader stuff
    var vertexShader = document.getElementById("vertexshader")
      .textContent
      .replace("{{PIXELS_PER_AU}}", Number(50).toFixed(1));

    var fragmentShader = document.getElementById("fragmentshader").textContent;

    var particleSystemShaderMaterial = new THREE.ShaderMaterial({
        uniforms: particleUniforms,
        attributes: particleAttributes,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader
    });

    particleSystemShaderMaterial.depthTest = false;
    particleSystemShaderMaterial.vertexColor = true;
    particleSystemShaderMaterial.transparent = true;
    particleSystemShaderMaterial.blending = THREE.AdditiveBlending;

    for (var i = 0; i < added_objects.length; i++) {
      // Assign starting values
      particleAttributes.phi.value[i] = added_objects[i].eph.phi;
      particleAttributes.theta.value[i] = added_objects[i].eph.theta;
      particleAttributes.radius.value[i] = added_objects[i].eph.radius;
      particleAttributes.size.value[i] = added_objects[i].opts.object_size;
      particleAttributes.speed.value[i] = added_objects[i].eph.speed;
      particleAttributes.value_color.value[i] = added_objects[i].eph.value_color;
      particleAttributes.value_alpha.value[i] = added_objects[i].eph.value_alpha;
    }

    particleSystem = new THREE.PointCloud(
      geometry,
      particleSystemShaderMaterial
    );

    // add PointCloud to the scene
    scene.add(particleSystem);

    Marathon.Events.success(function (apps) {
      totalStagedCounter = 0;
      apps.forEach(function (appData) {
        totalStagedCounter += appData.tasksStaged;
      });
      hudElements.loading.className = "";
    });

    Marathon.Events.created(function (task) {
      var taskId = task.id;
      var groupedRadius = null;
      var targetColor = stagingColor;
      var j = taskIdLookupTable[taskId];
      if (j === undefined) {
        // pick a new particle
        j = parseInt(particlesPointers.pop());
        taskIdLookupTable[taskId] = parseInt(j);
      }
      // Update app labels in HUD
      var pos = appIds.indexOf(task.appId);
      if (pos === -1) {
        if (appIds.length < maxApps) {
          pos = appIds.push(task.appId) - 1;
          if (hudElements.individualAppLabels[pos]) {
            hudElements.individualAppLabels[pos].textContent = task.appId
              .toString()
              .toUpperCase();
          }
        }
      }
      if (pos > -1) {
        targetColor = colorScheme[Object.keys(colorScheme)[pos]];
        // Grouped by color
        var minR = pointCloudRadiusMin;
        var maxR = pointCloudRadiusMax - ((maxApps - pos) * radiusStep) + radiusStep;
        groupedRadius = minR + maxR + Math.random() * radiusStep - radiusStep;
        individualAppCounters[pos]++;
        // Set app index
        initialParticles[j].id = pos;
      }

      initialParticles[j].visible = pos > -1
        ? hudElements.individualAppToggles[pos].checked
        : true;
      initialParticles[j].running = task.running;
      initialParticles[j].targetColor = targetColor;
      if (groupedRadius) initialParticles[j].groupedRadius = groupedRadius;
      initialParticles[j].transitionEnd.alpha = false;
      initialParticles[j].transitionEnd.initialRadius = !!isToggleGroupedActive;
      initialParticles[j].transitionEnd.groupedRadius = !isToggleGroupedActive;
      hudElements.loading.className = "";
    });

    Marathon.Events.updated(function (task) {
      var taskId = task.id;
      var targetColor = stagingColor;
      var groupedRadius = null;
      var j = taskIdLookupTable[taskId];
      if (j === undefined) {
        // pick a new particle
        j = parseInt(particlesPointers.pop());
        taskIdLookupTable[taskId] = j;
      }
      var pos = appIds.indexOf(task.appId);
      if (pos > -1) {
        targetColor = colorScheme[Object.keys(colorScheme)[pos]];
        // Grouped by color
        var minR = pointCloudRadiusMin;
        var maxR = pointCloudRadiusMax - ((maxApps - pos) * radiusStep) + radiusStep;
        groupedRadius = minR + maxR + Math.random() * radiusStep - radiusStep;
        // Set app index
        initialParticles[j].id = pos;
      }
      initialParticles[j].visible = pos > -1
        ? hudElements.individualAppToggles[pos].checked
        : true;
      initialParticles[j].running = task.running;
      initialParticles[j].targetColor = targetColor;
      if (groupedRadius) initialParticles[j].groupedRadius = groupedRadius;
      initialParticles[j].transitionEnd.alpha = false;
      initialParticles[j].transitionEnd.initialRadius = !!isToggleGroupedActive;
      initialParticles[j].transitionEnd.groupedRadius = !isToggleGroupedActive;
      hudElements.loading.className = "";
    });

    Marathon.Events.deleted(function (task) {
      var taskId = task.id;
      var j = taskIdLookupTable[taskId];
      particlesPointers.push(j.toString());
      initialParticles[j].visible = false;
      initialParticles[j].running = 0;
      hudElements.loading.className = "";
    });

    Marathon.Events.error(function () {
      hudElements.loading.className = "active";
    });

    // Kaboom
    Marathon.startPolling();
    doBindings();
    animate();
  }

  function moveCamera() {
    if (cameraIsMoving) return;
    cameraIsMoving = true;
    var theta = 10;
    var x = camera.position.x;
    var y = camera.position.y;
    var z = camera.position.z;

    var moveX = x * Math.cos(theta) + z * Math.sin(theta);
    var moveY = y * Math.cos(theta) + z * Math.sin(theta);
    var moveZ = z * Math.cos(theta) - z * Math.sin(theta);

    new TWEEN.Tween(camera.position)
      .to({x: moveX, y: moveY, z: moveZ}, 15000)
      .easing(TWEEN.Easing.Cubic.InOut)
      .onUpdate(function () {
        camera.updateProjectionMatrix();
      })
      .onComplete(function () {
        cameraIsMoving = false;
      })
      .yoyo(true)
      .repeat(Infinity)
      .start();
  }

  function animate() {
    render();

    requestAnimationFrame(animate);

    particleUniforms.jed.value = jed;
    jed += 0.12;

    if (flyCamera) {
      moveCamera();
      TWEEN.update();
    }
    cameraControls.update();
    // Uncomment to capture camera position values
    //if (JSON.stringify(lastCameraPos) != JSON.stringify(camera.position)) {
    //  lastCameraPos = JSON.parse(JSON.stringify(camera.position));
    //  console.log(camera.position);
    //}

    // Animation loop
    for (var i = 0; i < maxParticles; i++) {
      var p = initialParticles[i];

      // Animate to light
      var alpha = particleAttributes.value_alpha.value[i];
      var targetAlpha = p.visible ? 0.5 : 0.0;
      animationDirections.alpha[i] = p.visible ? -1 : 1;
      if (p.visible && alpha < targetAlpha ||
        !p.visible && alpha > targetAlpha) {
        if (!p.transitionEnd.alpha) {
          var da = alpha - 1.0;
          var va = da * easeAlpha;
          particleAttributes.value_alpha.value[i] +=
            va * animationDirections.alpha[i];
        } else {
          particleAttributes.value_alpha.value[i] = targetAlpha;
          initialParticles[i].transitionEnd.alpha = true;
        }
      }

      // Animate grouped radius
      if (!p.transitionEnd.groupedRadius &&
        p.transitionEnd.initialRadius) {
        var radius = particleAttributes.radius.value[i];
        var groupedRadius = p.groupedRadius;
        var dr = groupedRadius - radius;
        var vr = dr * ease;
        particleAttributes.radius.value[i] += vr;
        if (parseInt(radius) === parseInt(groupedRadius)) {
          initialParticles[i].transitionEnd.groupedRadius = true;
        }
      }

      // Animate to initial radius
      if (!p.transitionEnd.initialRadius &&
        p.transitionEnd.groupedRadius) {
        var radius = particleAttributes.radius.value[i];
        var initialRadius = p.initialRadius;
        var dr = initialRadius - radius;
        var vr = dr * ease;
        particleAttributes.radius.value[i] += vr;
        if (parseInt(radius) === parseInt(initialRadius)) {
          initialParticles[i].transitionEnd.initialRadius = true;
        }
      }
      // Update color for running tasks
      if (parseInt(p.running) === 1) {
        particleAttributes.value_color.value[i] = p.targetColor;
      } else {
        particleAttributes.value_color.value[i] = stagingColor;
      }
    }

    // Update global counter
    var currentTotalCounter = parseInt(hudElements.totalInstancesCounter.dataset.value);
    var totalCounter = maxParticles -particlesPointers.length;
    if (currentTotalCounter !== totalCounter) {
      var dct = totalCounter - currentTotalCounter;
      var vct = dct * ease;
      var tot = Math.ceil(currentTotalCounter + vct);
      hudElements.totalInstancesCounter.dataset.value = tot;
      hudElements.totalInstancesCounter.textContent = tot.toLocaleString();
    }

    // Update staged counter
    var currentStagedCounter = parseInt(hudElements.totalStagedCounter.dataset.value);
    if (currentStagedCounter !== totalStagedCounter) {
      var dct = totalStagedCounter - currentStagedCounter;
      var vct = dct * ease;
      var tot = Math.floor(currentStagedCounter + vct);
      hudElements.totalStagedCounter.dataset.value = tot;
      hudElements.totalStagedCounter.textContent = tot.toLocaleString();
    }

    // Update individual app counters
    for (var i = 0; i < maxApps; i++) {
      var currentAppCounter = parseInt(hudElements.individualAppCounters[i].dataset.value);
      var targetAppCounter = individualAppCounters[i];
      if (currentAppCounter !== targetAppCounter) {
        var dct = targetAppCounter - currentAppCounter;
        var vct = dct * ease;
        var tot = Math.ceil(currentAppCounter + vct);
        hudElements.individualAppCounters[i].dataset.value = tot;
        hudElements.individualAppCounters[i].textContent = tot.toLocaleString();
      }
    }

    // Sorry, GPU
    geometry.__dirtyVertices = true;
    particleAttributes.radius.needsUpdate = true;
    particleAttributes.phi.needsUpdate = true;
    particleAttributes.theta.needsUpdate = true;
    particleAttributes.speed.needsUpdate = true;
    particleAttributes.value_alpha.needsUpdate = true;
    particleAttributes.value_color.needsUpdate = true;
  }

  function render() {
    renderer.render(scene, camera);
  }

  function toJED(d) {
    return Math.floor((d.getTime() / (1000 * 60 * 60 * 24)) - 0.5) + 2440588;
  }

  function onWindowResize() {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    camera.aspect = viewportWidth / viewportHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  document.addEventListener("DOMContentLoaded", init, false);
  window.addEventListener("resize", onWindowResize);

})();