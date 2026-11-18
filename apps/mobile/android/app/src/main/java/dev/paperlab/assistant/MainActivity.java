package dev.paperlab.assistant;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UpdateInstallerPlugin.class);
        registerPlugin(ShareInPlugin.class);
        registerPlugin(PerfPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
