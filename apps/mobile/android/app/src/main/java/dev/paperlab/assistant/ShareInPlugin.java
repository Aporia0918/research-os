package dev.paperlab.assistant;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 分享到思维账本: text shared from another app (an AI's answer, a selected passage) arrives as ACTION_SEND text/plain.
 * The text waits here until JS takes it once; a share while the app is open also fires a "shared" event.
 * Only plain text is accepted. Not yet run on a real phone.
 */
@CapacitorPlugin(name = "ShareIn")
public class ShareInPlugin extends Plugin {
    private static final int MAX = 8000;
    private String pending = null;

    @Override
    public void load() { capture(getActivity().getIntent()); }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (capture(intent)) notifyListeners("shared", new JSObject());
    }

    private boolean capture(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) return false;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null || text.toString().trim().isEmpty()) return false;
        String s = text.toString().trim();
        pending = s.length() > MAX ? s.substring(0, MAX) : s;
        intent.setAction(Intent.ACTION_MAIN); // taken once: a later resume must not book it again
        return true;
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("text", pending == null ? "" : pending);
        pending = null;
        call.resolve(ret);
    }
}
