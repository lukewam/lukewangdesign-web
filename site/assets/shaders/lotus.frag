precision highp float;

uniform bool isShadowPass;
uniform sampler2D keyShadowMap;
uniform sampler2D firstAmbientOcclusionMap;
uniform sampler2D secondAmbientOcclusionMap;
uniform mat3 firstAmbientProjectionBasis;
uniform mat3 secondAmbientProjectionBasis;
uniform float highlightStrength;
uniform vec3 cameraPosition;

varying vec3 surfaceNormal;
varying vec3 worldPosition;
varying vec3 lightSpacePosition;
varying vec3 materialProperties;
varying vec3 petalCoordinates;

const vec3 LIGHT_DIRECTION = vec3(-0.8, 0.48, 0.36);

/**
 * Packs a depth value into the four color channels of a shadow map.
 * @param {float} depthValue - Normalized fragment depth.
 * @returns {vec4} The packed depth channels.
 */
vec4 packDepthValue(float depthValue) {
    vec4 packedDepth = fract(depthValue * vec4(16777216.0, 65536.0, 256.0, 1.0));
    packedDepth -= packedDepth.xxyz * vec4(0.0, 1.0 / 256.0, 1.0 / 256.0, 1.0 / 256.0);
    return packedDepth;
}

/**
 * Restores a depth value from a shadow map's color channels.
 * @param {vec4} depthValue - Packed depth channels.
 * @returns {float} The normalized depth value.
 */
float unpackDepthValue(vec4 depthValue) {
    return dot(depthValue, vec4(1.0 / 16777216.0, 1.0 / 65536.0, 1.0 / 256.0, 1.0));
}

/**
 * Averages nine depth comparisons to soften shadow edges.
 * @param {sampler2D} depthMap - Packed depth texture.
 * @param {vec3} projectedPosition - Surface position in normalized light coordinates.
 * @param {float} mapResolution - Width and height of the square shadow map.
 * @param {float} depthBias - Offset that prevents a surface from shadowing itself.
 * @returns {float} The visible proportion of the sampled light.
 */
float calculateShadowVisibility(
    sampler2D depthMap,
    vec3 projectedPosition,
    float mapResolution,
    float depthBias
) {
    if (projectedPosition.x < 0.0 || projectedPosition.y < 0.0
        || projectedPosition.x > 1.0 || projectedPosition.y > 1.0
        || projectedPosition.z > 1.0) return 1.0;

    float visibleSampleCount = 0.0;
    for (int verticalSampleOffset = -1; verticalSampleOffset <= 1; verticalSampleOffset++)
        for (int horizontalSampleOffset = -1; horizontalSampleOffset <= 1; horizontalSampleOffset++) {
            float depthValue = unpackDepthValue(texture2D(
                depthMap,
                projectedPosition.xy + vec2(float(horizontalSampleOffset), float(verticalSampleOffset)) / mapResolution
            ));
            visibleSampleCount += projectedPosition.z - depthBias <= depthValue ? 1.0 : 0.0;
        }
    return visibleSampleCount / 9.0;
}

/**
 * Shades the lotus and stores luminance, material, highlights, and visibility.
 * @returns {void} Writes the packed fragment color or the shadow-pass depth.
 */
void main() {
    if (isShadowPass) {
        gl_FragColor = packDepthValue(gl_FragCoord.z);
        return;
    }

    vec3 normalDirection = normalize(surfaceNormal);
    if (!gl_FrontFacing) normalDirection = -normalDirection;
    float signedKeyLight = dot(normalDirection, LIGHT_DIRECTION);
    float diffuseLight = max(0.0, signedKeyLight);
    float keyLightVisibility = calculateShadowVisibility(
        keyShadowMap, lightSpacePosition, 1024.0, 0.00055 + 0.0008 * (1.0 - diffuseLight)
    );
    float firstAmbientVisibility = calculateShadowVisibility(
        firstAmbientOcclusionMap, (firstAmbientProjectionBasis * worldPosition) * 0.5 + 0.5, 512.0, 0.0010
    );
    float secondAmbientVisibility = calculateShadowVisibility(
        secondAmbientOcclusionMap, (secondAmbientProjectionBasis * worldPosition) * 0.5 + 0.5, 512.0, 0.0010
    );
    float ambientVisibility = firstAmbientVisibility * 0.52 + secondAmbientVisibility * 0.48;
    vec3 viewDirection = normalize(cameraPosition - worldPosition);
    float halfVectorAlignment = max(0.0, dot(normalDirection, normalize(LIGHT_DIRECTION + viewDirection)));
    float specularLight = (0.72 * pow(halfVectorAlignment, 18.0) + 0.28 * pow(halfVectorAlignment, 70.0)) * keyLightVisibility;
    float materialKind = materialProperties.x;
    float fillLightFacing = max(0.0, dot(normalDirection, normalize(vec3(0.3, 0.25, 1.0))));

    /** Reflected light gives shape to the shaded surfaces. */
    float fillLight = (0.07 + 0.22 * pow(fillLightFacing, 1.25)) * (0.38 + 0.62 * ambientVisibility);
    float keyLight = 0.91 * diffuseLight * (0.16 + 0.84 * keyLightVisibility);
    float luminance = fillLight + keyLight;

    if (materialKind < 0.5) {
        float petalLengthPosition = clamp(petalCoordinates.y, 0.0, 1.0);
        float petalWidthPosition = clamp(petalCoordinates.x, 0.0, 1.0) * 2.0 - 1.0;
        /** Thin rims transmit light while the cupped base holds a deeper value. */
        float baseOcclusion = 0.40 + 0.60 * smoothstep(0.025, 0.48, petalLengthPosition);
        float transmittedLight = 0.16 * max(0.0, -signedKeyLight) * (0.35 + 0.65 * ambientVisibility);
        float rimWeight = pow(abs(petalWidthPosition), 3.0) * sin(3.14159265 * petalLengthPosition);
        float rimLight = 0.13 * rimWeight * (0.25 + 0.75 * diffuseLight) * keyLightVisibility;
        luminance = (luminance + transmittedLight) * baseOcclusion + rimLight + 0.34 * specularLight * highlightStrength;
    } else if (materialKind < 2.5) {
        luminance = luminance * 0.43 + specularLight * 0.22 * highlightStrength;
    } else {
        luminance = luminance * 0.66 + specularLight * 0.22 * highlightStrength;
    }

    /** The perceptual transfer preserves the gradual values in the shadows. */
    luminance = 0.055 + 0.90 * pow(clamp(luminance, 0.0, 1.0), 0.72);
    float visibility = materialKind > 2.5 && materialKind < 3.5
        ? smoothstep(-2.60, -1.25, worldPosition.y) : 1.0;
    gl_FragColor = vec4(
        clamp(luminance, 0.0, 1.0),
        materialKind / 8.0,
        clamp(specularLight * highlightStrength, 0.0, 1.0),
        visibility
    );
}
