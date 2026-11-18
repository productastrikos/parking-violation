package xyz.astrikos.parkpatrol;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Saves a ticket picture where a laptop can read it over the USB cable
 * ("File transfer" mode). Called from src/guard/cable/nativeSave.ts.
 *
 *   Android 10+   the shared Pictures/ParkPatrol folder, through MediaStore
 *                 (no storage permission needed);
 *   Android 7–9   this app's own Pictures folder
 *                 (Android/data/xyz.astrikos.parkpatrol/files/Pictures/ParkPatrol).
 */
@CapacitorPlugin(name = "CableSaver")
public class CableSaverPlugin extends Plugin {

    @PluginMethod
    public void savePng(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        if (name == null || data == null) {
            call.reject("name and data are required");
            return;
        }
        name = name.replaceAll("[^A-Za-z0-9._-]", "_");
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            String folder;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/ParkPatrol");
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new Exception("the phone refused to create the picture");
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new Exception("could not open the picture for writing");
                    out.write(bytes);
                }
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
                folder = "Pictures/ParkPatrol";
            } else {
                File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES), "ParkPatrol");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("could not create " + dir);
                File file = new File(dir, name);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                }
                MediaScannerConnection.scanFile(getContext(), new String[] { file.getAbsolutePath() }, new String[] { "image/png" }, null);
                folder = "Android/data/" + getContext().getPackageName() + "/files/Pictures/ParkPatrol";
            }
            JSObject ret = new JSObject();
            ret.put("folder", folder);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not save the picture: " + e.getMessage(), e);
        }
    }
}
