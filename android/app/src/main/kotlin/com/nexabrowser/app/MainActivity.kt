package com.nexabrowser.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Button

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<Button>(R.id.btnSlot0).setOnClickListener {
            startActivity(Intent(this, SlotActivity0::class.java))
        }
        findViewById<Button>(R.id.btnSlot1).setOnClickListener {
            startActivity(Intent(this, SlotActivity1::class.java))
        }
        findViewById<Button>(R.id.btnBrowser).setOnClickListener {
            startActivity(Intent(this, BrowserActivity::class.java))
        }
    }
}
