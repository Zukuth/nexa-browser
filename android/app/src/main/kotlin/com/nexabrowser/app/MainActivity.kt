package com.nexabrowser.app

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.nexabrowser.app.data.Account
import com.nexabrowser.app.data.AppDatabase
import com.nexabrowser.app.data.Space
import com.nexabrowser.app.slots.AccountSlotManager
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * The account hub — Fase 2's entry point, extended in Fase 4 with espacios
 * (data.spaces[] on desktop): a horizontal rail above the list lets you
 * switch which space's accounts are shown, mirroring desktop's space
 * switcher without needing a full sidebar on a phone-sized screen.
 */
class MainActivity : androidx.appcompat.app.AppCompatActivity() {

    private val db by lazy { AppDatabase.getInstance(this) }
    private val prefs by lazy { getSharedPreferences("app_prefs", MODE_PRIVATE) }
    private lateinit var adapter: com.nexabrowser.app.ui.AccountAdapter
    private lateinit var emptyState: TextView
    private lateinit var spaceRail: LinearLayout

    private var currentSpaceId: String? = null

    private val palette = listOf("#4F8CFF", "#FF6B6B", "#51CF66", "#FCC419", "#CC5DE8", "#FF922B", "#F06595", "#22B8CF")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        emptyState = findViewById(R.id.emptyState)
        spaceRail = findViewById(R.id.spaceRail)
        val list = findViewById<RecyclerView>(R.id.accountList)
        list.layoutManager = LinearLayoutManager(this)
        adapter = com.nexabrowser.app.ui.AccountAdapter(
            onOpen = { account -> openAccount(account) },
            onDelete = { account -> confirmDelete(account) },
            onEdit = { account -> showEditAccountDialog(account) }
        )
        list.adapter = adapter

        findViewById<Button>(R.id.btnAddAccount).setOnClickListener { showAddAccountDialog() }
        findViewById<ImageButton>(R.id.btnPasswords).setOnClickListener {
            startActivity(Intent(this, PasswordsActivity::class.java))
        }
    }

    override fun onResume() {
        super.onResume()
        lifecycleScope.launch {
            ensureDefaultSpace()
            refreshSpaces()
        }
    }

    // Mirrors desktop's DEFAULT_DATA.spaces — every install needs at least
    // one space for accounts to belong to. Checked on every resume rather
    // than once at install time since Room's data can be wiped independently
    // of the app (e.g. "clear storage" from Android settings).
    private suspend fun ensureDefaultSpace() {
        if (db.spaceDao().getAll().isNotEmpty()) return
        db.spaceDao().insert(
            Space(id = UUID.randomUUID().toString(), name = "General", colorHex = palette[0], createdAt = System.currentTimeMillis())
        )
    }

    private suspend fun refreshSpaces() {
        val spaces = db.spaceDao().getAll()
        if (spaces.isEmpty()) return // ensureDefaultSpace() just ran; onResume will re-enter
        val savedId = prefs.getString(KEY_CURRENT_SPACE, null)
        val active = spaces.find { it.id == savedId } ?: spaces.first()
        currentSpaceId = active.id
        renderSpaceRail(spaces, active.id)
        refreshAccounts()
    }

    private fun renderSpaceRail(spaces: List<Space>, activeId: String) {
        spaceRail.removeAllViews()
        val density = resources.displayMetrics.density
        spaces.forEach { space ->
            spaceRail.addView(buildChip(space.name, space.id == activeId) { switchSpace(space.id) }, chipParams(density))
        }
        spaceRail.addView(buildChip("+ Espacio", selected = false) { showAddSpaceDialog() }, chipParams(density))
    }

    private fun chipParams(density: Float) = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
    ).apply { marginEnd = (8 * density).toInt() }

    private fun buildChip(label: String, selected: Boolean, onClick: () -> Unit): TextView {
        val density = resources.displayMetrics.density
        return TextView(this).apply {
            text = label
            setPadding((16 * density).toInt(), (8 * density).toInt(), (16 * density).toInt(), (8 * density).toInt())
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setBackgroundResource(if (selected) R.drawable.chip_selected else R.drawable.chip_unselected)
            setOnClickListener { onClick() }
        }
    }

    private fun switchSpace(spaceId: String) {
        if (spaceId == currentSpaceId) return
        currentSpaceId = spaceId
        prefs.edit().putString(KEY_CURRENT_SPACE, spaceId).apply()
        lifecycleScope.launch { refreshSpaces() }
    }

    private fun showAddSpaceDialog() {
        val view = layoutInflater.inflate(R.layout.dialog_add_space, null)
        val inputName = view.findViewById<EditText>(R.id.inputName)
        AlertDialog.Builder(this)
            .setTitle("Nuevo espacio")
            .setView(view)
            .setPositiveButton("Crear") { _, _ ->
                val name = inputName.text.toString().trim().ifEmpty { "Espacio" }
                lifecycleScope.launch {
                    val existingCount = db.spaceDao().getAll().size
                    val space = Space(
                        id = UUID.randomUUID().toString(),
                        name = name,
                        colorHex = palette[existingCount % palette.size],
                        createdAt = System.currentTimeMillis()
                    )
                    db.spaceDao().insert(space)
                    currentSpaceId = space.id
                    prefs.edit().putString(KEY_CURRENT_SPACE, space.id).apply()
                    refreshSpaces()
                }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun refreshAccounts() {
        val spaceId = currentSpaceId ?: return
        lifecycleScope.launch {
            val accounts = db.accountDao().getAllInSpace(spaceId)
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
        val spaceId = currentSpaceId ?: return
        lifecycleScope.launch {
            val existingCount = db.accountDao().getAll().size
            val account = Account(
                id = UUID.randomUUID().toString(),
                name = name,
                url = url,
                colorHex = palette[existingCount % palette.size],
                createdAt = System.currentTimeMillis(),
                lastActiveAt = System.currentTimeMillis(),
                spaceId = spaceId
            )
            db.accountDao().insert(account)
            refreshAccounts()
        }
    }

    private fun showEditAccountDialog(account: Account) {
        val view = layoutInflater.inflate(R.layout.dialog_edit_account, null)
        val inputName = view.findViewById<EditText>(R.id.inputName).apply { setText(account.name) }
        val inputUrl = view.findViewById<EditText>(R.id.inputUrl).apply { setText(account.url) }
        val inputProxyServer = view.findViewById<EditText>(R.id.inputProxyServer).apply { setText(account.proxyServer ?: "") }
        val inputProxyUsername = view.findViewById<EditText>(R.id.inputProxyUsername).apply { setText(account.proxyUsername ?: "") }
        val inputProxyPassword = view.findViewById<EditText>(R.id.inputProxyPassword).apply { setText(account.proxyPassword ?: "") }

        AlertDialog.Builder(this)
            .setTitle("Editar cuenta")
            .setView(view)
            .setPositiveButton("Guardar") { _, _ ->
                val name = inputName.text.toString().trim().ifEmpty { account.name }
                val urlInput = inputUrl.text.toString().trim()
                val url = when {
                    urlInput.isEmpty() -> account.url
                    urlInput.startsWith("http://") || urlInput.startsWith("https://") -> urlInput
                    else -> "https://$urlInput"
                }
                val proxyServer = inputProxyServer.text.toString().trim().ifEmpty { null }
                val proxyUsername = inputProxyUsername.text.toString().trim().ifEmpty { null }
                val proxyPassword = inputProxyPassword.text.toString().ifEmpty { null }
                lifecycleScope.launch {
                    db.accountDao().update(account.id, name, url, proxyServer, proxyUsername, proxyPassword)
                    refreshAccounts()
                }
            }
            .setNegativeButton("Cancelar", null)
            .show()
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

    companion object {
        private const val KEY_CURRENT_SPACE = "current_space_id"
    }
}
