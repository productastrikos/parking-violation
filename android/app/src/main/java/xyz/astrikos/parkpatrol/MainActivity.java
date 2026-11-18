package xyz.astrikos.parkpatrol;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins: ticket pictures for the USB-cable handover, and the pocket fine printer.
        registerPlugin(CableSaverPlugin.class);
        registerPlugin(FinePrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
