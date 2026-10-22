package com.kebabzilla.ui.glass

import org.intellij.lang.annotations.Language

/**
 * Exact AGSL shader implementations from Kyant's AndroidLiquidGlass (Backdrop) library:
 * https://github.com/Kyant0/AndroidLiquidGlass
 *
 * Modified to extend sides and top into oblivion (offscreen) so the glass bleeds
 * edge-to-edge into the status bar and screen edges with zero visible side corners,
 * while maintaining the bottom refractive meniscus lens and chromatic dispersion.
 */
object LiquidGlassShaders {

    @Language("AGSL")
    private const val RoundedRectSDF = """
float radiusAt(float2 coord, float4 radii) {
    if (coord.x >= 0.0) {
        if (coord.y <= 0.0) return radii.y;
        else return radii.z;
    } else {
        if (coord.y <= 0.0) return radii.x;
        else return radii.w;
    }
}

float sdRoundedRect(float2 coord, float2 halfSize, float radius) {
    float2 cornerCoord = abs(coord) - (halfSize - float2(radius));
    float outside = length(max(cornerCoord, 0.0)) - radius;
    float inside = min(max(cornerCoord.x, cornerCoord.y), 0.0);
    return outside + inside;
}

float2 gradSdRoundedRect(float2 coord, float2 halfSize, float radius) {
    float2 cornerCoord = abs(coord) - (halfSize - float2(radius));
    if (cornerCoord.x >= 0.0 || cornerCoord.y >= 0.0) {
        return sign(coord) * normalize(max(cornerCoord, 0.0));
    } else {
        float gradX = step(cornerCoord.y, cornerCoord.x);
        return sign(coord) * float2(gradX, 1.0 - gradX);
    }
}
"""

    @Language("AGSL")
    const val RoundedRectRefractionWithDispersionShaderString = """
uniform shader content;

uniform float2 size;
uniform float2 offset;
uniform float4 cornerRadii;
uniform float refractionHeight;
uniform float refractionAmount;
uniform float depthEffect;
uniform float chromaticAberration;

$RoundedRectSDF

float circleMap(float x) {
    return 1.0 - sqrt(max(0.0, 1.0 - x * x));
}

half4 main(float2 coord) {
    // Sides are extended into oblivion (2000px offscreen) so no side borders are visible,
    // while both top and bottom edges feature symmetrical liquid meniscus refraction and chromatic dispersion.
    const float overflowX = 2000.0;
    
    float2 virtualSize = float2(size.x + 2.0 * overflowX, size.y);
    float2 virtualHalfSize = virtualSize * 0.5;
    float2 virtualCoord = float2(coord.x + overflowX, coord.y);
    float2 centeredCoord = virtualCoord - virtualHalfSize;
    
    float radius = cornerRadii.x;
    float sd = sdRoundedRect(centeredCoord, virtualHalfSize, radius);
    if (-sd >= refractionHeight) {
        return content.eval(coord);
    }
    sd = min(sd, 0.0);
    
    float d = circleMap(1.0 - -sd / max(0.001, refractionHeight)) * refractionAmount;
    float gradRadius = min(radius * 1.5, min(virtualHalfSize.x, virtualHalfSize.y));
    float2 grad = normalize(gradSdRoundedRect(centeredCoord, virtualHalfSize, gradRadius) + depthEffect * float2(0.0, sign(centeredCoord.y)));
    
    float2 refractedCoord = coord + d * grad;
    if (chromaticAberration <= 0.0) {
        return content.eval(refractedCoord);
    }
    
    float dispersionFactor = abs(centeredCoord.y) / max(1.0, virtualHalfSize.y);
    float dispersionIntensity = chromaticAberration * dispersionFactor;
    float2 dispersedCoord = d * grad * dispersionIntensity * 0.15;
    
    half4 color = half4(0.0);
    
    half4 red = content.eval(refractedCoord + dispersedCoord);
    color.r += red.r / 3.5;
    color.a += red.a / 7.0;
    
    half4 orange = content.eval(refractedCoord + dispersedCoord * (2.0 / 3.0));
    color.r += orange.r / 3.5;
    color.g += orange.g / 7.0;
    color.a += orange.a / 7.0;
    
    half4 yellow = content.eval(refractedCoord + dispersedCoord * (1.0 / 3.0));
    color.r += yellow.r / 3.5;
    color.g += yellow.g / 3.5;
    color.a += yellow.a / 7.0;
    
    half4 green = content.eval(refractedCoord);
    color.g += green.g / 3.5;
    color.a += green.a / 7.0;
    
    half4 cyan = content.eval(refractedCoord - dispersedCoord * (1.0 / 3.0));
    color.g += cyan.g / 3.5;
    color.b += cyan.b / 3.0;
    color.a += cyan.a / 7.0;
    
    half4 blue = content.eval(refractedCoord - dispersedCoord * (2.0 / 3.0));
    color.b += blue.b / 3.0;
    color.a += blue.a / 7.0;
    
    half4 purple = content.eval(refractedCoord - dispersedCoord);
    color.r += purple.r / 7.0;
    color.b += purple.b / 3.0;
    color.a += purple.a / 7.0;
    
    return color;
}
"""

    @Language("AGSL")
    const val DefaultHighlightShaderString = """
uniform float2 size;
uniform float4 cornerRadii;
layout(color) uniform half4 color;
uniform float angle;
uniform float falloff;

$RoundedRectSDF

half4 main(float2 coord) {
    const float overflowX = 2000.0;
    
    float2 virtualSize = float2(size.x + 2.0 * overflowX, size.y);
    float2 virtualHalfSize = virtualSize * 0.5;
    float2 virtualCoord = float2(coord.x + overflowX, coord.y);
    float2 centeredCoord = virtualCoord - virtualHalfSize;
    
    float radius = cornerRadii.x;
    float gradRadius = min(radius * 1.5, min(virtualHalfSize.x, virtualHalfSize.y));
    float2 grad = gradSdRoundedRect(centeredCoord, virtualHalfSize, gradRadius);
    float2 normal = float2(cos(angle), sin(angle));
    float d = dot(grad, normal);
    float intensity = pow(abs(d), falloff);
    return color * intensity;
}
"""
}
