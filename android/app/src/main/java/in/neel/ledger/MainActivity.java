package in.neel.ledger;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LedgerPlugin.class);
        super.onCreate(savedInstanceState);

        // Keep balances out of the app switcher's thumbnail and out of
        // screenshots. A phone gets handed around; a ledger should not be
        // readable from the recents screen.
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );
    }
}
