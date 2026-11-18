package dev.paperlab.assistant;

import android.util.Log;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * One fixed log line when the first screen can take input, so a cold-start run can time launch → ready from logcat
 * (.github/workflows/perf-android.yml). It carries no data.
 */
@CapacitorPlugin(name = "Perf")
public class PerfPlugin extends Plugin {
    @PluginMethod
    public void ready(PluginCall call) {
        Log.i("PerfReady", "first screen ready");
        call.resolve();
    }
}
