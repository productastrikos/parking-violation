package xyz.astrikos.parkpatrol;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;

import androidx.core.content.FileProvider;
import androidx.print.PrintHelper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The guard's pocket fine printer, from the Android app (the app's WebView has
 * no Web Bluetooth, share sheet or print dialog). Called from
 * src/guard/print/nativePrinter.ts; the notice itself is drawn in the web code
 * (notice.ts) and arrives here as ESC/POS bytes or a PNG, base64-encoded.
 *
 *   listPrinters  the phone's paired Bluetooth devices (pair the printer once in
 *                 Android Settings → Bluetooth)
 *   printEscPos   classic Bluetooth serial (SPP) to an ESC/POS thermal printer
 *   rawbt         hand the job to the RawBT print-service app (BLE / USB / Wi-Fi printers)
 *   shareImage    the notice image to the printer maker's app via the share sheet
 *   systemPrint   Android's print dialog (Mopria / maker print plug-in)
 */
@CapacitorPlugin(
    name = "FinePrinter",
    permissions = { @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }) }
)
public class FinePrinterPlugin extends Plugin {

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    /* ── Bluetooth permission (Android 12+ asks at run time) ─────────────── */
    private boolean needsBluetoothPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    private String usableAdapterProblem(BluetoothAdapter a) {
        if (a == null) return "This phone has no Bluetooth";
        if (!a.isEnabled()) return "Bluetooth is off — turn it on and try again";
        return null;
    }

    /* ── paired printers ─────────────────────────────────────────────────── */
    @PluginMethod
    public void listPrinters(PluginCall call) {
        if (needsBluetoothPermission()) {
            requestPermissionForAlias("bluetooth", call, "listAfterPermission");
            return;
        }
        doList(call);
    }

    @PermissionCallback
    private void listAfterPermission(PluginCall call) {
        if (needsBluetoothPermission()) {
            call.reject("Bluetooth permission is needed to find the printer — allow it and try again");
            return;
        }
        doList(call);
    }

    @SuppressLint("MissingPermission")
    private void doList(PluginCall call) {
        BluetoothAdapter a = adapter();
        String problem = usableAdapterProblem(a);
        if (problem != null) {
            call.reject(problem);
            return;
        }
        JSArray list = new JSArray();
        for (BluetoothDevice d : a.getBondedDevices()) {
            JSObject o = new JSObject();
            String name = d.getName();
            o.put("name", name == null || name.isEmpty() ? d.getAddress() : name);
            o.put("address", d.getAddress());
            BluetoothClass cls = d.getBluetoothClass();
            int major = cls == null ? BluetoothClass.Device.Major.UNCATEGORIZED : cls.getMajorDeviceClass();
            // Thermal printers report "imaging" or nothing at all; phones, audio and wearables are not printers.
            o.put("printerLike", major == BluetoothClass.Device.Major.IMAGING || major == BluetoothClass.Device.Major.UNCATEGORIZED);
            list.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("printers", list);
        call.resolve(ret);
    }

    /* ── print over classic Bluetooth (SPP) ──────────────────────────────── */
    @PluginMethod
    public void printEscPos(PluginCall call) {
        if (needsBluetoothPermission()) {
            requestPermissionForAlias("bluetooth", call, "printAfterPermission");
            return;
        }
        doPrint(call);
    }

    @PermissionCallback
    private void printAfterPermission(PluginCall call) {
        if (needsBluetoothPermission()) {
            call.reject("Bluetooth permission is needed to print — allow it and try again");
            return;
        }
        doPrint(call);
    }

    @SuppressLint("MissingPermission")
    private void doPrint(PluginCall call) {
        String address = call.getString("address");
        String data = call.getString("data");
        if (address == null || data == null) {
            call.reject("address and data are required");
            return;
        }
        io.execute(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothAdapter a = adapter();
                String problem = usableAdapterProblem(a);
                if (problem != null) throw new Exception(problem);
                BluetoothDevice device = a.getRemoteDevice(address);
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                socket = connect(device);
                OutputStream out = socket.getOutputStream();
                final int chunk = 512;
                for (int i = 0; i < bytes.length; i += chunk) {
                    out.write(bytes, i, Math.min(chunk, bytes.length - i));
                    out.flush();
                    Thread.sleep(12); // pace the small printer buffer
                }
                // Let the printer take in the last bytes before the link closes (closing early cuts the notice short).
                Thread.sleep(Math.min(4000, 500 + bytes.length / 40));
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not print: " + friendly(e), e);
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (IOException ignored) {
                        // closed already
                    }
                }
            }
        });
    }

    /** SPP via SDP lookup; then the insecure variant; then RFCOMM channel 1 directly (some printers only answer there). */
    @SuppressLint("MissingPermission")
    private BluetoothSocket connect(BluetoothDevice d) throws Exception {
        BluetoothSocket s = null;
        try {
            s = d.createRfcommSocketToServiceRecord(SPP);
            s.connect();
            return s;
        } catch (IOException first) {
            closeQuietly(s);
        }
        try {
            s = d.createInsecureRfcommSocketToServiceRecord(SPP);
            s.connect();
            return s;
        } catch (IOException second) {
            closeQuietly(s);
        }
        s = (BluetoothSocket) d.getClass().getMethod("createRfcommSocket", int.class).invoke(d, 1);
        try {
            s.connect();
            return s;
        } catch (IOException third) {
            closeQuietly(s);
            throw new Exception("the printer did not answer. Check it is switched on, charged and close by. (Printers that only speak Bluetooth LE: use RawBT.)");
        }
    }

    private static void closeQuietly(BluetoothSocket s) {
        if (s == null) return;
        try {
            s.close();
        } catch (IOException ignored) {
            // nothing to do
        }
    }

    private static String friendly(Exception e) {
        String m = e.getMessage();
        return m == null || m.isEmpty() ? e.getClass().getSimpleName() : m;
    }

    /* ── RawBT print service ─────────────────────────────────────────────── */
    @PluginMethod
    public void rawbt(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("data is required");
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("rawbt:base64," + data));
        i.setPackage("ru.a402d.rawbtprinter");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("RawBT is not installed on this phone — install it (while online) or use another way to print");
        }
    }

    /* ── share the notice image (printer maker's app) ────────────────────── */
    @PluginMethod
    public void shareImage(PluginCall call) {
        try {
            File file = writePng(call);
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/png");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "Print the notice with…");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not share the notice: " + friendly(e), e);
        }
    }

    /* ── Android print dialog ────────────────────────────────────────────── */
    @PluginMethod
    public void systemPrint(PluginCall call) {
        String data = call.getString("data");
        String name = call.getString("name", "Penalty notice");
        if (data == null) {
            call.reject("data is required");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bmp == null) {
            call.reject("Could not read the notice image");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                PrintHelper helper = new PrintHelper(getActivity());
                helper.setScaleMode(PrintHelper.SCALE_MODE_FIT);
                helper.setColorMode(PrintHelper.COLOR_MODE_MONOCHROME);
                helper.printBitmap(name, bmp);
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not open the print dialog: " + friendly(e), e);
            }
        });
    }

    private File writePng(PluginCall call) throws IOException {
        String data = call.getString("data");
        if (data == null) throw new IOException("data is required");
        String name = call.getString("name", "notice").replaceAll("[^A-Za-z0-9._-]", "_");
        File dir = new File(getContext().getCacheDir(), "notices");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("could not create " + dir);
        File file = new File(dir, name.endsWith(".png") ? name : name + ".png");
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(Base64.decode(data, Base64.DEFAULT));
        }
        return file;
    }
}
