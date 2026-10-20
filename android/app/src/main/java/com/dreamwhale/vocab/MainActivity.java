package com.dreamwhale.vocab;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(DreamwhalePlugin.class);
        super.onCreate(state);
    }
}
