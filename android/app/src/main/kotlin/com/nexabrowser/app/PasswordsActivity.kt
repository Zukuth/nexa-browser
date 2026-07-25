package com.nexabrowser.app

import android.app.AlertDialog
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.TextView
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.nexabrowser.app.data.AppDatabase
import com.nexabrowser.app.data.PasswordEntry
import com.nexabrowser.app.security.PasswordCrypto
import com.nexabrowser.app.ui.PasswordAdapter
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Contraseñas guardadas — lista/agrega/borra. The plaintext password is only
 * ever held in a local variable in [addPassword]'s Kotlin scope, long enough
 * to hand it to [PasswordCrypto.encrypt]; nothing here ever surfaces it back
 * to the UI (this list only shows name/username, never the password itself,
 * matching the desktop app's Configuración → Contraseñas screen).
 */
class PasswordsActivity : androidx.appcompat.app.AppCompatActivity() {

    private val db by lazy { AppDatabase.getInstance(this) }
    private lateinit var adapter: PasswordAdapter
    private lateinit var emptyState: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_passwords)

        emptyState = findViewById(R.id.emptyState)
        val list = findViewById<RecyclerView>(R.id.passwordList)
        list.layoutManager = LinearLayoutManager(this)
        adapter = PasswordAdapter(onDelete = { entry -> confirmDelete(entry) })
        list.adapter = adapter

        findViewById<ImageButton>(R.id.btnBack).setOnClickListener { finish() }
        findViewById<Button>(R.id.btnAddPassword).setOnClickListener { showAddPasswordDialog() }
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        lifecycleScope.launch {
            val entries = db.passwordDao().getAll()
            adapter.submit(entries)
            emptyState.visibility = if (entries.isEmpty()) View.VISIBLE else View.GONE
        }
    }

    private fun showAddPasswordDialog() {
        val view = layoutInflater.inflate(R.layout.dialog_add_password, null)
        val inputName = view.findViewById<EditText>(R.id.inputName)
        val inputUrl = view.findViewById<EditText>(R.id.inputUrl)
        val inputUsername = view.findViewById<EditText>(R.id.inputUsername)
        val inputPassword = view.findViewById<EditText>(R.id.inputPassword)

        AlertDialog.Builder(this)
            .setTitle("Nueva contraseña")
            .setView(view)
            .setPositiveButton("Guardar") { _, _ ->
                val url = inputUrl.text.toString().trim()
                val password = inputPassword.text.toString()
                if (url.isEmpty() || password.isEmpty()) return@setPositiveButton
                val name = inputName.text.toString().trim().ifEmpty { url }
                val username = inputUsername.text.toString().trim()
                addPassword(name, url, username, password)
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun addPassword(name: String, url: String, username: String, password: String) {
        val entry = PasswordEntry(
            id = UUID.randomUUID().toString(),
            name = name,
            url = url,
            username = username,
            encryptedPassword = PasswordCrypto.encrypt(password),
            createdAt = System.currentTimeMillis()
        )
        lifecycleScope.launch {
            db.passwordDao().insert(entry)
            refresh()
        }
    }

    private fun confirmDelete(entry: PasswordEntry) {
        AlertDialog.Builder(this)
            .setTitle("Eliminar contraseña")
            .setMessage("¿Eliminar la contraseña guardada para \"${entry.name}\"?")
            .setPositiveButton("Eliminar") { _, _ ->
                lifecycleScope.launch {
                    db.passwordDao().delete(entry)
                    refresh()
                }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }
}
