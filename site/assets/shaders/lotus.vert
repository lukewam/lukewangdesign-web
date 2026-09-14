precision highp float;

attribute vec4 closedPositionAndPetalLength;
attribute vec4 closedNormalAndPetalIndex;
attribute vec4 openPositionAndMaterialKind;
attribute vec4 openNormalAndPetalWidth;

uniform float bloomAmount;
uniform float travelFoldAmount;
uniform float travelSwayAmount;
uniform float travelTurnAmount;
uniform float travelPhase;
uniform float attentionAmount;
uniform vec3 cameraRotation;
uniform vec2 viewportSize;
uniform vec3 screenPlacement;
uniform mat3 shadowProjectionBasis;
uniform bool isShadowPass;

varying vec3 surfaceNormal;
varying vec3 worldPosition;
varying vec3 lightSpacePosition;
varying vec3 materialProperties;
varying vec3 petalCoordinates;

const float PI_RADIANS = 3.14159265359;
const vec3 LIGHT_DIRECTION = vec3(-0.8, 0.48, 0.36);
const vec3 LIGHT_HORIZONTAL_AXIS = vec3(0.4103647, 0.0, 0.9119215);
const vec3 LIGHT_VERTICAL_AXIS = vec3(0.4377223, 0.8772685, -0.1969751);

/**
 * Rotates a position or normal around the horizontal axis.
 * @param {vec3} position - Vector to rotate.
 * @param {float} angle - Rotation in radians.
 * @returns {vec3} The rotated vector.
 */
vec3 rotateAroundXAxis(vec3 position, float angle) {
    float cosineAngle = cos(angle), sineAngle = sin(angle);
    return vec3(
        position.x,
        position.y * cosineAngle - position.z * sineAngle,
        position.y * sineAngle + position.z * cosineAngle
    );
}

/**
 * Rotates a position or normal around the vertical axis.
 * @param {vec3} position - Vector to rotate.
 * @param {float} angle - Rotation in radians.
 * @returns {vec3} The rotated vector.
 */
vec3 rotateAroundYAxis(vec3 position, float angle) {
    float cosineAngle = cos(angle), sineAngle = sin(angle);
    return vec3(
        position.x * cosineAngle + position.z * sineAngle,
        position.y,
        -position.x * sineAngle + position.z * cosineAngle
    );
}

/**
 * Rotates a position or normal around the depth axis.
 * @param {vec3} position - Vector to rotate.
 * @param {float} angle - Rotation in radians.
 * @returns {vec3} The rotated vector.
 */
vec3 rotateAroundZAxis(vec3 position, float angle) {
    float cosineAngle = cos(angle), sineAngle = sin(angle);
    return vec3(
        position.x * cosineAngle - position.y * sineAngle,
        position.x * sineAngle + position.y * cosineAngle,
        position.z
    );
}

/**
 * Rotates a vector around a petal hinge axis.
 * @param {vec3} position - Vector relative to the hinge.
 * @param {vec3} rotationAxis - Normalized axis of rotation.
 * @param {float} angle - Rotation in radians.
 * @returns {vec3} The rotated vector.
 */
vec3 rotateAroundAxis(vec3 position, vec3 rotationAxis, float angle) {
    float cosineAngle = cos(angle), sineAngle = sin(angle);
    return position * cosineAngle
        + cross(rotationAxis, position) * sineAngle
        + rotationAxis * dot(rotationAxis, position) * (1.0 - cosineAngle);
}

/**
 * Applies flower movement and projects the result for a light or camera pass.
 * @returns {void} Writes the projected vertex and interpolated surface properties.
 */
void main() {
    float materialKind = openPositionAndMaterialKind.w;
    vec3 position = openPositionAndMaterialKind.xyz;
    vec3 normalDirection = openNormalAndPetalWidth.xyz;

    if (materialKind < 0.5) {
        float petalRing = closedNormalAndPetalIndex.w < 7.0
            ? 0.0 : closedNormalAndPetalIndex.w < 13.0 ? 1.0 : 2.0;
        float bloomDelay = petalRing * 0.13;
        float petalBloomAmount = smoothstep(
            0.0, 1.0, clamp((bloomAmount - bloomDelay) / (1.0 - bloomDelay), 0.0, 1.0)
        );

        if (travelFoldAmount > 0.0) {
            /** Each petal yields a little later during the normal bloom cycle. */
            float petalVariation = fract(sin(closedNormalAndPetalIndex.w * 12.9898 + 4.17) * 43758.5453);
            float motionResponse = smoothstep(petalRing * 0.045 + petalVariation * 0.055, 0.94, travelFoldAmount);
            float foldRipple = 0.95 + 0.05 * sin(travelPhase * 2.15 - closedNormalAndPetalIndex.w * 1.73 - petalRing * 0.60);
            float closingAmount = (0.19 - petalRing * 0.023) * motionResponse * foldRipple;
            petalBloomAmount *= 1.0 - closingAmount;
        }

        position = mix(closedPositionAndPetalLength.xyz, openPositionAndMaterialKind.xyz, petalBloomAmount);
        normalDirection = normalize(mix(closedNormalAndPetalIndex.xyz, openNormalAndPetalWidth.xyz, petalBloomAmount));

        if (attentionAmount > 0.0 && closedNormalAndPetalIndex.w > 3.5 && closedNormalAndPetalIndex.w < 5.5) {
            /**
             * Two outer-left petals open beyond their rest pose. The hinge uses
             * their root centroids from the closed and open meshes.
             */
            bool isFrontLeftPetal = closedNormalAndPetalIndex.w < 4.5;
            vec3 closedRootPosition = isFrontLeftPetal
                ? vec3(-0.042666, 0.580303, 0.085290)
                : vec3(-0.091960, 0.580229, 0.025061);
            vec3 openRootPosition = isFrontLeftPetal
                ? vec3(-0.001099, 0.593632, 0.017646)
                : vec3(-0.005986, 0.688557, 0.015802);
            vec3 hingePosition = mix(closedRootPosition, openRootPosition, petalBloomAmount);
            vec3 rotationAxis = normalize(isFrontLeftPetal
                ? vec3(1.162, 0.0, 0.683)
                : vec3(0.175, 0.0, 1.311));
            float motionResponse = isFrontLeftPetal
                ? attentionAmount : smoothstep(0.12, 1.0, attentionAmount);
            float rotationAngle = (isFrontLeftPetal ? 0.07853981634 : 0.06283185307) * motionResponse;
            position = hingePosition + rotateAroundAxis(position - hingePosition, rotationAxis, rotationAngle);
            normalDirection = rotateAroundAxis(normalDirection, rotationAxis, rotationAngle);
        }
    }

    if (materialKind < 2.5 && (abs(travelSwayAmount) > 0.0 || abs(travelTurnAmount) > 0.0)) {
        /**
         * The head moves around the stem tip. Rotating its normals by the same
         * amount keeps the highlights attached to the moving surfaces.
         */
        float nodAngle = travelSwayAmount * 0.05235987756;
        float headTurnAngle = travelTurnAmount * 0.38397243544;
        vec3 stemAttachment = vec3(0.0, 0.55, 0.0);
        position = rotateAroundZAxis(rotateAroundYAxis(position - stemAttachment, headTurnAngle), nodAngle) + stemAttachment;
        normalDirection = rotateAroundZAxis(rotateAroundYAxis(normalDirection, headTurnAngle), nodAngle);
    }

    worldPosition = position;
    surfaceNormal = normalDirection;
    materialProperties = vec3(materialKind, closedPositionAndPetalLength.w, closedNormalAndPetalIndex.w);
    petalCoordinates = vec3(openNormalAndPetalWidth.w, closedPositionAndPetalLength.w, closedNormalAndPetalIndex.w);
    vec3 projectedLightPosition = vec3(
        dot(position, LIGHT_HORIZONTAL_AXIS) / 2.55,
        dot(position, LIGHT_VERTICAL_AXIS) / 2.55,
        -dot(position, LIGHT_DIRECTION) / 4.0
    );
    lightSpacePosition = projectedLightPosition * 0.5 + 0.5;

    if (isShadowPass) gl_Position = vec4(shadowProjectionBasis * position, 1.0);
    else {
        vec3 cameraSpacePosition = rotateAroundXAxis(
            rotateAroundYAxis(position - vec3(0.0, 0.55, 0.0), cameraRotation.y),
            0.74 + cameraRotation.x
        );
        float cameraDistance = 7.5 - cameraSpacePosition.z;
        vec2 screenOffset = vec2(
            screenPlacement.x / viewportSize.x * 2.0 - 1.0,
            1.0 - screenPlacement.y / viewportSize.y * 2.0
        );
        vec2 screenScale = vec2(screenPlacement.z * 15.0) / viewportSize;
        gl_Position = vec4(
            cameraSpacePosition.xy * screenScale + screenOffset * cameraDistance,
            1.1428571 * cameraDistance - 2.1428571,
            cameraDistance
        );
    }
}
