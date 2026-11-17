package com.hi.petals;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // PetalsFiles: MediaStore save to Gallery + open hidden folder.
        // See android/app/src/main/java/com/hi/petals/PetalsFilesPlugin.java.
        // PetalsUpdate: in-app update download + install intent.
        // See android/app/src/main/java/com/hi/petals/PetalsUpdatePlugin.java.
        // PetalsMedia: custom media picker, recent photos/videos grid.
        // See android/app/src/main/java/com/hi/petals/PetalsMediaPlugin.java.
        registerPlugin(PetalsFilesPlugin.class);
        registerPlugin(PetalsUpdatePlugin.class);
        registerPlugin(PetalsMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
