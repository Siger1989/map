package com.shantu.qa149;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/** Narrow bridge to the app's validated UI material runtime. Never evaluates caller JavaScript. */
final class NativePreviewMaterial {
    interface ScriptEvaluator { String evaluate(String script) throws Exception; }

    private static final String SCHEMA = "shantu.material.v1";
    private static final Set<String> ALLOWED_PACKAGES = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("com.shantu.oldengine", "com.shantu.hybridprobe")));
    private static final Set<String> TOKEN_NAMES;
    static {
        Set<String> names = new HashSet<>(Arrays.asList(
            "--ui-glass-surface", "--ui-material-panel", "--ui-material-favorites",
            "--ui-material-topbar", "--ui-material-bottom", "--ui-material-rail", "--ui-material-toast",
            "--ui-button", "--ui-raised", "--ui-control-subtle", "--ui-close", "--ui-field",
            "--ui-selected", "--ui-active", "--ui-accent", "--ui-on-accent", "--ui-ink",
            "--ui-glass-ink", "--ui-button-ink", "--ui-muted", "--ui-glass-muted", "--ui-line",
            "--ui-glass-line", "--ui-glass-border", "--ui-switch-on", "--ui-switch-off",
            "--ui-on-switch", "--ui-on-switch-off", "--ui-glass-filter", "--ui-glass-shadow",
            "--ui-radius-card", "--ui-radius-control", "--ui-glass-edge-width", "--ui-selected-ink",
            "--ui-active-ink", "--ui-input-radius", "--ui-search-width", "--ui-search-padding",
            "--ui-search-gap", "--ui-search-row-height"));
        TOKEN_NAMES = Collections.unmodifiableSet(names);
    }

    private final String targetPackage;
    private final ScriptEvaluator evaluator;

    NativePreviewMaterial(String targetPackage, ScriptEvaluator evaluator) {
        this.targetPackage = targetPackage;
        this.evaluator = evaluator;
    }

    JSONObject read() throws Exception {
        requireAllowedTarget();
        return invoke("read", null);
    }

    JSONObject apply(JSONObject material) throws Exception {
        requireAllowedTarget();
        JSONObject safe = validateMaterial(material);
        return invoke("apply", safe);
    }

    JSONObject restore() throws Exception {
        requireAllowedTarget();
        return invoke("restore", null);
    }

    private void requireAllowedTarget() {
        if (!ALLOWED_PACKAGES.contains(targetPackage))
            throw new SecurityException("material actions require an isolated Shantu target");
    }

    private JSONObject invoke(String operation, JSONObject argument) throws Exception {
        String script = "(()=>{const r=window.__shantuMaterialRuntime;"
            + "if(!r||typeof r." + operation + "!=='function')return JSON.stringify({ok:false,supported:false,error:'当前App未接入共用材质通道'});"
            + "try{const v=r." + operation + "(" + (argument == null ? "" : "JSON.parse(" + JSONObject.quote(argument.toString()) + ")") + ");"
            + "if(v&&typeof v.then==='function')return JSON.stringify({ok:false,supported:true,error:'材质通道必须同步完成'});"
            + "if(v&&v.supported===false)return JSON.stringify({ok:false,supported:false,error:v.error||'当前App未接入共用材质通道'});"
            + "const m=v&&v.material?v.material:v;return JSON.stringify({ok:true,supported:true,material:m});"
            + "}catch(e){return JSON.stringify({ok:false,supported:true,error:'材质操作失败'});}})()";
        String raw = evaluator.evaluate(script);
        JSONObject response = new JSONObject(raw);
        if (!response.optBoolean("ok", false)) return response;
        JSONObject material = response.optJSONObject("material");
        if (material == null) return new JSONObject().put("ok", false).put("supported", true).put("error", "材质通道返回格式无效");
        JSONObject filtered = validateMaterial(material);
        return new JSONObject().put("ok", true).put("supported", true).put("material", filtered);
    }

    private static JSONObject validateMaterial(JSONObject input) throws JSONException {
        if (input == null || !SCHEMA.equals(input.optString("schema")))
            throw new IllegalArgumentException("material schema must be shantu.material.v1");
        Object revisionValue = input.opt("revision");
        if (!(revisionValue instanceof Number)) throw new IllegalArgumentException("material revision must be a non-negative integer");
        double revisionNumber = ((Number)revisionValue).doubleValue();
        long revision = ((Number)revisionValue).longValue();
        if (revision < 0 || revisionNumber != (double)revision) throw new IllegalArgumentException("material revision must be a non-negative integer");
        JSONObject tokens = input.optJSONObject("tokens");
        if (tokens == null || tokens.length() > 64) throw new IllegalArgumentException("material tokens must contain at most 64 entries");
        JSONObject safeTokens = new JSONObject();
        for (Iterator<String> it = tokens.keys(); it.hasNext();) {
            String name = it.next();
            Object value = tokens.opt(name);
            if (!TOKEN_NAMES.contains(name)) throw new IllegalArgumentException("unsupported material token: " + name);
            if (!(value instanceof String) || ((String)value).length() > 256)
                throw new IllegalArgumentException("material token values must be strings up to 256 characters");
            safeTokens.put(name, value);
        }
        return new JSONObject().put("schema", SCHEMA).put("revision", revision).put("tokens", safeTokens);
    }
}
