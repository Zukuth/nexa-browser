package com.nexabrowser.app

import android.app.AlertDialog
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.nexabrowser.app.data.Account
import com.nexabrowser.app.data.AppDatabase
import com.nexabrowser.app.slots.AccountSlotManager
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * The account hub — Fase 2's entry point. Lists every saved account, lets
 * you add one, tap one to open it (AccountSlotManager decides which of the 4
 * processes it lands in), or delete one (which also evicts its slot if it's
 * currently live).
 */
class MainActivity : androidx.appcompat.app.AppCompatActivity() {

    private val db by lazy { AppDatabase.getInstance(this) }
    private lateinit var adapter: com.nexabrowser.app.ui.AccountAdapter
    private lateinit var emptyState: TextView

    private val palette = listOf("#4F8CFF", "#FF6B6B", "#51CF66", "#FCC419", "#CC5DE8", "#FF922B", "#F06595", "#22B8CF")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        emptyState = findViewById(R.id.emptyState)
        val list = findViewById<RecyclerView>(R.id.accountList)
        list.layoutManager = LinearLayoutManager(this)
        adapter = com.nexabrowser.app.ui.AccountAdapter(
            onOpen = { account -> openAccount(account) },
            onDelete = { account -> confirmDelete(account) }
        )
        list.adapter = adapter

        findViewById<Button>(R.id.btnAddAccount).setOnClickListener { showAddAccountDialog() }
    }

    override fun onResume() {
        super.onResume()
        refreshAccounts()
    }

    private fun refreshAccounts() {
        lifecycleScope.launch {
            val accounts = db.accountDao().getAll()
            adapter.submit(accounts)
            emptyState.visibility = if (accounts.isEmpty()) View.VISIBLE else View.GONE
        }
    }

    private fun showAddAccountDialog() {
        val view = layoutInflater.inflate(R.layout.dialog_add_account, null)
        val inputName = view.findViewById<EditText>(R.id.inputName)
        val inputUrl = view.findViewById<EditText>(R.id.inputUrl)

        AlertDialog.Builder(this)
            .setTitle("Nueva cuenta")
            .setView(view)
            .setPositiveButton("Agregar") { _, _ ->
                val name = inputName.text.toString().trim().ifEmpty { "Cuenta" }
                val urlInput = inputUrl.text.toString().trim()
                val url = when {
                    urlInput.isEmpty() -> "https://www.google.com/"
                    urlInput.startsWith("http://") || urlInput.startsWith("https://") -> urlInput
                    else -> "https://$urlInput"
                }
                addAccount(name, url)
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun addAccount(name: String, url: String) {
        lifecycleScope.launch {
            val existingCount = db.accountDao().getAll().size
            val account = Account(
                id = UUID.randomUUID().toString(),
                name = name,
                url = url,
                colorHex = palette[existingCount % palette.size],
                createdAt = System.currentTimeMillis(),
                lastActiveAt = System.currentTimeMillis()
            )
            db.accountDao().insert(account)
            refreshAccounts()
        }
    }

    private fun openAccount(account: Account) {
        lifecycleScope.launch {
            AccountSlotManager.openAccount(this@MainActivity, account.id, account.name)
        }
    }

    private fun confirmDelete(account: Account) {
        AlertDialog.Builder(this)
            .setTitle("Eliminar cuenta")
            .setMessage("¿Eliminar \"${account.name}\"? Esto no se puede deshacer.")
            .setPositiveButton("Eliminar") { _, _ -> deleteAccount(account) }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun deleteAccount(account: Account) {
        lifecycleScope.launch {
            AccountSlotManager.closeAccount(this@MainActivity, account.id)
            db.accountDao().delete(account)
            refreshAccounts()
        }
    }
}
