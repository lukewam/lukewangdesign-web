/**
 * @typedef {object} LotusMeshData
 * @property {string} vertexAttributesBase64 - Base64 vertex records in the compact mesh format.
 * @property {string} triangleIndicesBase64 - Base64 unsigned 16-bit triangle indices.
 * @property {number} vertexCount - Number of vertex records.
 * @property {number} triangleCount - Number of triangles.
 */

/**
 * @typedef {object} TravelMotion
 * @property {number} fold - Travel-driven folding amount.
 * @property {number} sway - Sideways head movement.
 * @property {number} turn - Head rotation around the stem.
 * @property {number} phase - Phase of the traveling petal ripple.
 * @property {number} attention - Extra opening of the two outer-left petals.
 */

/**
 * @typedef {object} RenderTarget
 * @property {WebGLTexture} texture - Color attachment.
 * @property {WebGLRenderbuffer} depthBuffer - Depth attachment.
 * @property {WebGLFramebuffer} framebuffer - Framebuffer for the render pass.
 * @property {number} width - Width in pixels.
 * @property {number} height - Height in pixels.
 */

/**
 * Creates the lotus renderer and keeps its shadow maps between frames.
 *
 * @param {LotusMeshData} lotusMeshData - Compressed closed and open lotus geometry.
 * @param {string} vertexShaderSource - Source from the lotus vertex shader.
 * @param {string} fragmentShaderSource - Source from the lotus fragment shader.
 * @returns {{render: Function} | null} The renderer, or null when WebGL is unavailable.
 */
export function createLotusRenderer(
  lotusMeshData,
  vertexShaderSource,
  fragmentShaderSource,
) {
  const renderCanvas = document.createElement("canvas");
  const webglContext = renderCanvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!webglContext) {
    return null;
  }
  /**
   * Compiles a shader and reports the WebGL compiler's error when compilation fails.
   *
   * @param {number} shaderType - WebGL vertex or fragment shader constant.
   * @param {string} shaderSource - GLSL source to compile.
   * @returns {WebGLShader} The compiled shader.
   */
  function compileShader(shaderType, shaderSource) {
    const compiledShader = webglContext.createShader(shaderType);
    webglContext.shaderSource(compiledShader, shaderSource);
    webglContext.compileShader(compiledShader);
    if (
      !webglContext.getShaderParameter(
        compiledShader,
        webglContext.COMPILE_STATUS,
      )
    ) {
      throw new Error(webglContext.getShaderInfoLog(compiledShader));
    }
    return compiledShader;
  }
  const shaderProgram = webglContext.createProgram();
  webglContext.attachShader(
    shaderProgram,
    compileShader(webglContext.VERTEX_SHADER, vertexShaderSource),
  );
  webglContext.attachShader(
    shaderProgram,
    compileShader(webglContext.FRAGMENT_SHADER, fragmentShaderSource),
  );
  webglContext.linkProgram(shaderProgram);
  if (
    !webglContext.getProgramParameter(shaderProgram, webglContext.LINK_STATUS)
  ) {
    throw new Error(webglContext.getProgramInfoLog(shaderProgram));
  }
  webglContext.useProgram(shaderProgram);
  const meshData = lotusMeshData;
  /**
   * Restores the byte sequence stored in a compressed mesh field.
   *
   * @param {string} encodedText - Base64 text containing geometry bytes.
   * @returns {Uint8Array} The decoded bytes.
   */
  function decodeBase64(encodedText) {
    const decodedText = atob(encodedText);
    const decodedBytes = new Uint8Array(decodedText.length);
    for (let byteIndex = 0; byteIndex < decodedText.length; byteIndex++) {
      decodedBytes[byteIndex] = decodedText.charCodeAt(byteIndex);
    }
    return decodedBytes;
  }
  const vertexBytes = decodeBase64(meshData.vertexAttributesBase64);
  const vertexDataView = new DataView(vertexBytes.buffer);
  const vertexAttributes = new Float32Array(meshData.vertexCount * 16);
  for (let vertexIndex = 0; vertexIndex < meshData.vertexCount; vertexIndex++) {
    const compressedVertexOffset = vertexIndex * 22;
    const attributeOffset = vertexIndex * 16;
    for (let coordinateIndex = 0; coordinateIndex < 3; coordinateIndex++) {
      vertexAttributes[attributeOffset + coordinateIndex] =
        vertexDataView.getInt16(
          compressedVertexOffset + coordinateIndex * 2,
          true,
        ) / 8192;
      vertexAttributes[attributeOffset + 8 + coordinateIndex] =
        vertexDataView.getInt16(
          compressedVertexOffset + 6 + coordinateIndex * 2,
          true,
        ) / 8192;
      vertexAttributes[attributeOffset + 4 + coordinateIndex] =
        (vertexBytes[compressedVertexOffset + 12 + coordinateIndex] - 127) /
        127;
      vertexAttributes[attributeOffset + 12 + coordinateIndex] =
        (vertexBytes[compressedVertexOffset + 15 + coordinateIndex] - 127) /
        127;
    }
    vertexAttributes[attributeOffset + 3] =
      vertexBytes[compressedVertexOffset + 18] / 255;
    vertexAttributes[attributeOffset + 7] =
      vertexBytes[compressedVertexOffset + 19];
    vertexAttributes[attributeOffset + 11] =
      vertexBytes[compressedVertexOffset + 20];
    vertexAttributes[attributeOffset + 15] =
      vertexBytes[compressedVertexOffset + 21] / 255;
  }
  const decodedIndexBytes = decodeBase64(meshData.triangleIndicesBase64);
  const triangleIndices = new Uint16Array(decodedIndexBytes.buffer);
  const vertexBuffer = webglContext.createBuffer();
  webglContext.bindBuffer(webglContext.ARRAY_BUFFER, vertexBuffer);
  webglContext.bufferData(
    webglContext.ARRAY_BUFFER,
    new Float32Array(vertexAttributes),
    webglContext.STATIC_DRAW,
  );
  [
    ["closedPositionAndPetalLength", 4, 0],
    ["closedNormalAndPetalIndex", 4, 16],
    ["openPositionAndMaterialKind", 4, 32],
    ["openNormalAndPetalWidth", 4, 48],
  ].forEach(([attributeName, attributeComponentCount, attributeByteOffset]) => {
    const attributeLocation = webglContext.getAttribLocation(
      shaderProgram,
      attributeName,
    );
    webglContext.enableVertexAttribArray(attributeLocation);
    webglContext.vertexAttribPointer(
      attributeLocation,
      attributeComponentCount,
      webglContext.FLOAT,
      false,
      64,
      attributeByteOffset,
    );
  });
  const triangleIndexBuffer = webglContext.createBuffer();
  webglContext.bindBuffer(
    webglContext.ELEMENT_ARRAY_BUFFER,
    triangleIndexBuffer,
  );
  webglContext.bufferData(
    webglContext.ELEMENT_ARRAY_BUFFER,
    new Uint16Array(triangleIndices),
    webglContext.STATIC_DRAW,
  );
  const uniformLocations = {};
  [
    "bloomAmount",
    "travelFoldAmount",
    "travelSwayAmount",
    "travelTurnAmount",
    "travelPhase",
    "attentionAmount",
    "cameraRotation",
    "viewportSize",
    "screenPlacement",
    "isShadowPass",
    "keyShadowMap",
    "highlightStrength",
    "cameraPosition",
    "shadowProjectionBasis",
    "firstAmbientOcclusionMap",
    "secondAmbientOcclusionMap",
    "firstAmbientProjectionBasis",
    "secondAmbientProjectionBasis",
  ].forEach(
    (uniformName) =>
      (uniformLocations[uniformName] = webglContext.getUniformLocation(
        shaderProgram,
        uniformName,
      )),
  );
  /**
   * Allocates a color texture and depth buffer for a shadow map or scene pass.
   *
   * @param {number} width - Render target width in pixels.
   * @param {number} height - Render target height in pixels.
   * @returns {RenderTarget} The texture, depth buffer, framebuffer, and dimensions.
   */
  function createRenderTarget(width, height) {
    const texture = webglContext.createTexture();
    webglContext.bindTexture(webglContext.TEXTURE_2D, texture);
    webglContext.texImage2D(
      webglContext.TEXTURE_2D,
      0,
      webglContext.RGBA,
      width,
      height,
      0,
      webglContext.RGBA,
      webglContext.UNSIGNED_BYTE,
      null,
    );
    webglContext.texParameteri(
      webglContext.TEXTURE_2D,
      webglContext.TEXTURE_MIN_FILTER,
      webglContext.NEAREST,
    );
    webglContext.texParameteri(
      webglContext.TEXTURE_2D,
      webglContext.TEXTURE_MAG_FILTER,
      webglContext.NEAREST,
    );
    webglContext.texParameteri(
      webglContext.TEXTURE_2D,
      webglContext.TEXTURE_WRAP_S,
      webglContext.CLAMP_TO_EDGE,
    );
    webglContext.texParameteri(
      webglContext.TEXTURE_2D,
      webglContext.TEXTURE_WRAP_T,
      webglContext.CLAMP_TO_EDGE,
    );
    const depthBuffer = webglContext.createRenderbuffer();
    webglContext.bindRenderbuffer(webglContext.RENDERBUFFER, depthBuffer);
    webglContext.renderbufferStorage(
      webglContext.RENDERBUFFER,
      webglContext.DEPTH_COMPONENT16,
      width,
      height,
    );
    const framebuffer = webglContext.createFramebuffer();
    webglContext.bindFramebuffer(webglContext.FRAMEBUFFER, framebuffer);
    webglContext.framebufferTexture2D(
      webglContext.FRAMEBUFFER,
      webglContext.COLOR_ATTACHMENT0,
      webglContext.TEXTURE_2D,
      texture,
      0,
    );
    webglContext.framebufferRenderbuffer(
      webglContext.FRAMEBUFFER,
      webglContext.DEPTH_ATTACHMENT,
      webglContext.RENDERBUFFER,
      depthBuffer,
    );
    return {
      texture,
      depthBuffer,
      framebuffer,
      width,
      height,
    };
  }
  /**
   * Builds the world-to-light projection used by the depth maps.
   *
   * @param {number[]} lightDirection - Direction from the surface toward the light.
   * @returns {Float32Array} The column-major three-by-three projection matrix.
   */
  function createLightBasisMatrix(lightDirection) {
    const directionLength = Math.hypot(...lightDirection);
    const normalizedDirection = lightDirection.map(
      (component) => component / directionLength,
    );
    let horizontalAxis = [normalizedDirection[2], 0, -normalizedDirection[0]];
    let horizontalAxisLength = Math.hypot(...horizontalAxis);
    horizontalAxis = horizontalAxis.map(
      (component) => component / horizontalAxisLength,
    );
    const verticalAxis = [
      normalizedDirection[1] * horizontalAxis[2] -
        normalizedDirection[2] * horizontalAxis[1],
      normalizedDirection[2] * horizontalAxis[0] -
        normalizedDirection[0] * horizontalAxis[2],
      normalizedDirection[0] * horizontalAxis[1] -
        normalizedDirection[1] * horizontalAxis[0],
    ];
    return new Float32Array([
      horizontalAxis[0] / 2.55,
      verticalAxis[0] / 2.55,
      -normalizedDirection[0] / 4,
      horizontalAxis[1] / 2.55,
      verticalAxis[1] / 2.55,
      -normalizedDirection[1] / 4,
      horizontalAxis[2] / 2.55,
      verticalAxis[2] / 2.55,
      -normalizedDirection[2] / 4,
    ]);
  }
  const keyLightBasis = createLightBasisMatrix([-0.8, 0.48, 0.36]);
  const firstAmbientLightBasis = createLightBasisMatrix([0.66, 0.72, 0.21]);
  const secondAmbientLightBasis = createLightBasisMatrix([0.06, 0.93, -0.36]);
  const keyShadowTarget = createRenderTarget(1024, 1024);
  const firstAmbientOcclusionTarget = createRenderTarget(512, 512);
  const secondAmbientOcclusionTarget = createRenderTarget(512, 512);
  let cachedShadowBloomAmount = -1;
  let cachedShadowTravelFoldAmount = -1;
  let cachedShadowTravelSwayAmount = -1;
  let cachedShadowTravelTurnAmount = -1;
  let cachedShadowTravelPhase = -1;
  let cachedShadowAttentionAmount = -1;
  let sceneRenderTarget = null;
  let pixelData = null;
  let cachedRenderState = null;
  webglContext.enable(webglContext.DEPTH_TEST);
  webglContext.depthFunc(webglContext.LEQUAL);
  webglContext.disable(webglContext.CULL_FACE);
  webglContext.disable(webglContext.BLEND);
  webglContext.disable(webglContext.DITHER);
  return {
    /**
     * Renders two samples per cell dimension and returns their packed RGBA values.
     * Red stores luminance, green stores material kind, blue stores specular light,
     * and alpha stores visibility. Identical inputs reuse the previous pixel data.
     *
     * @param {number} columnCount - Number of output character columns.
     * @param {number} rowCount - Number of output character rows.
     * @param {number} viewportWidth - Display width in pixels.
     * @param {number} viewportHeight - Display height in pixels.
     * @param {number} bloomAmount - Progress from the closed to the open mesh.
     * @param {number[]} cameraRotation - Camera rotation values in radians.
     * @param {number[]} screenPlacement - Screen position and scale.
     * @param {number} highlightStrength - Multiplier for specular highlights.
     * @param {TravelMotion} [travelMotion] - Folding, sway, turn, phase, and attention.
     * @returns {Uint8Array} Packed pixels read from the scene framebuffer.
     */
    render(
      columnCount,
      rowCount,
      viewportWidth,
      viewportHeight,
      bloomAmount,
      cameraRotation,
      screenPlacement,
      highlightStrength,
      travelMotion = {
        fold: 0,
        sway: 0,
        turn: 0,
        phase: 0,
        attention: 0,
      },
    ) {
      const travelFoldAmount = Number.isFinite(travelMotion.fold)
        ? Math.max(0, Math.min(1, travelMotion.fold))
        : 0;
      const travelSwayAmount = Number.isFinite(travelMotion.sway)
        ? Math.max(-1, Math.min(1, travelMotion.sway))
        : 0;
      const travelTurnAmount = Number.isFinite(travelMotion.turn)
        ? Math.max(-1, Math.min(1, travelMotion.turn))
        : 0;
      const attentionAmount = Number.isFinite(travelMotion.attention)
        ? Math.max(0, Math.min(1, travelMotion.attention))
        : 0;
      /** Idle phase is immaterial and must not invalidate the cached light maps. */
      const travelPhase =
        travelFoldAmount > 0 && Number.isFinite(travelMotion.phase)
          ? travelMotion.phase
          : 0;
      const currentRenderState = [
        columnCount,
        rowCount,
        viewportWidth,
        viewportHeight,
        bloomAmount,
        ...cameraRotation,
        ...screenPlacement,
        highlightStrength,
        travelFoldAmount,
        travelSwayAmount,
        travelTurnAmount,
        travelPhase,
        attentionAmount,
      ];
      if (
        cachedRenderState &&
        currentRenderState.every(
          (stateValue, stateValueIndex) =>
            stateValue === cachedRenderState[stateValueIndex],
        )
      ) {
        return pixelData;
      }
      if (
        !sceneRenderTarget ||
        sceneRenderTarget.width !== columnCount * 2 ||
        sceneRenderTarget.height !== rowCount * 2
      ) {
        if (sceneRenderTarget) {
          webglContext.deleteTexture(sceneRenderTarget.texture);
          webglContext.deleteRenderbuffer(sceneRenderTarget.depthBuffer);
          webglContext.deleteFramebuffer(sceneRenderTarget.framebuffer);
        }
        sceneRenderTarget = createRenderTarget(columnCount * 2, rowCount * 2);
        pixelData = new Uint8Array(columnCount * rowCount * 16);
      }
      webglContext.useProgram(shaderProgram);
      webglContext.uniform1f(uniformLocations.bloomAmount, bloomAmount);
      webglContext.uniform3fv(uniformLocations.cameraRotation, cameraRotation);
      webglContext.uniform1f(
        uniformLocations.travelFoldAmount,
        travelFoldAmount,
      );
      webglContext.uniform1f(
        uniformLocations.travelSwayAmount,
        travelSwayAmount,
      );
      webglContext.uniform1f(uniformLocations.travelPhase, travelPhase);
      webglContext.uniform1f(
        uniformLocations.travelTurnAmount,
        travelTurnAmount,
      );
      webglContext.uniform1f(uniformLocations.attentionAmount, attentionAmount);
      webglContext.uniform1f(
        uniformLocations.highlightStrength,
        highlightStrength,
      );
      const cameraElevation = 0.74 + cameraRotation[0];
      const cameraYaw = cameraRotation[1];
      webglContext.uniform3f(
        uniformLocations.cameraPosition,
        -7.5 * Math.cos(cameraElevation) * Math.sin(cameraYaw),
        0.55 + 7.5 * Math.sin(cameraElevation),
        7.5 * Math.cos(cameraElevation) * Math.cos(cameraYaw),
      );
      webglContext.uniform2f(
        uniformLocations.viewportSize,
        viewportWidth,
        viewportHeight,
      );
      webglContext.uniform3fv(
        uniformLocations.screenPlacement,
        screenPlacement,
      );
      /** Petal motion changes both the key shadow and the two contact-light maps. */
      /** The camera and whole-plant translation still reuse world-space light maps. */
      if (
        Math.abs(bloomAmount - cachedShadowBloomAmount) > 0.000001 ||
        Math.abs(travelFoldAmount - cachedShadowTravelFoldAmount) > 0.000001 ||
        Math.abs(travelSwayAmount - cachedShadowTravelSwayAmount) > 0.000001 ||
        Math.abs(travelTurnAmount - cachedShadowTravelTurnAmount) > 0.000001 ||
        Math.abs(travelPhase - cachedShadowTravelPhase) > 0.000001 ||
        Math.abs(attentionAmount - cachedShadowAttentionAmount) > 0.000001
      ) {
        for (let textureUnit = 0; textureUnit < 3; textureUnit++) {
          webglContext.activeTexture(webglContext.TEXTURE0 + textureUnit);
          webglContext.bindTexture(webglContext.TEXTURE_2D, null);
        }
        webglContext.uniform1i(uniformLocations.isShadowPass, 1);
        for (const [renderTarget, lightBasisMatrix] of [
          [keyShadowTarget, keyLightBasis],
          [firstAmbientOcclusionTarget, firstAmbientLightBasis],
          [secondAmbientOcclusionTarget, secondAmbientLightBasis],
        ]) {
          webglContext.bindFramebuffer(
            webglContext.FRAMEBUFFER,
            renderTarget.framebuffer,
          );
          webglContext.viewport(0, 0, renderTarget.width, renderTarget.height);
          webglContext.uniformMatrix3fv(
            uniformLocations.shadowProjectionBasis,
            false,
            lightBasisMatrix,
          );
          webglContext.clearColor(1, 1, 1, 1);
          webglContext.clear(
            webglContext.COLOR_BUFFER_BIT | webglContext.DEPTH_BUFFER_BIT,
          );
          webglContext.drawElements(
            webglContext.TRIANGLES,
            triangleIndices.length,
            webglContext.UNSIGNED_SHORT,
            0,
          );
        }
        cachedShadowBloomAmount = bloomAmount;
        cachedShadowTravelFoldAmount = travelFoldAmount;
        cachedShadowTravelSwayAmount = travelSwayAmount;
        cachedShadowTravelTurnAmount = travelTurnAmount;
        cachedShadowTravelPhase = travelPhase;
        cachedShadowAttentionAmount = attentionAmount;
      }
      webglContext.bindFramebuffer(
        webglContext.FRAMEBUFFER,
        sceneRenderTarget.framebuffer,
      );
      webglContext.viewport(
        0,
        0,
        sceneRenderTarget.width,
        sceneRenderTarget.height,
      );
      for (const [textureUnit, renderTarget, uniformName] of [
        [0, keyShadowTarget, "keyShadowMap"],
        [1, firstAmbientOcclusionTarget, "firstAmbientOcclusionMap"],
        [2, secondAmbientOcclusionTarget, "secondAmbientOcclusionMap"],
      ]) {
        webglContext.activeTexture(webglContext.TEXTURE0 + textureUnit);
        webglContext.bindTexture(webglContext.TEXTURE_2D, renderTarget.texture);
        webglContext.uniform1i(uniformLocations[uniformName], textureUnit);
      }
      webglContext.uniformMatrix3fv(
        uniformLocations.firstAmbientProjectionBasis,
        false,
        firstAmbientLightBasis,
      );
      webglContext.uniformMatrix3fv(
        uniformLocations.secondAmbientProjectionBasis,
        false,
        secondAmbientLightBasis,
      );
      webglContext.uniform1i(uniformLocations.isShadowPass, 0);
      webglContext.clearColor(1, 0, 0, 0);
      webglContext.clear(
        webglContext.COLOR_BUFFER_BIT | webglContext.DEPTH_BUFFER_BIT,
      );
      webglContext.drawElements(
        webglContext.TRIANGLES,
        triangleIndices.length,
        webglContext.UNSIGNED_SHORT,
        0,
      );
      webglContext.readPixels(
        0,
        0,
        sceneRenderTarget.width,
        sceneRenderTarget.height,
        webglContext.RGBA,
        webglContext.UNSIGNED_BYTE,
        pixelData,
      );
      cachedRenderState = currentRenderState;
      return pixelData;
    },
  };
}
