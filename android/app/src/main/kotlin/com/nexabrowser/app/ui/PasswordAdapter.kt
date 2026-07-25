package com.nexabrowser.app.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.nexabrowser.app.R
import com.nexabrowser.app.data.PasswordEntry

class PasswordAdapter(
    private val onDelete: (PasswordEntry) -> Unit
) : RecyclerView.Adapter<PasswordAdapter.ViewHolder>() {

    private var entries: List<PasswordEntry> = emptyList()

    fun submit(newEntries: List<PasswordEntry>) {
        entries = newEntries
        notifyDataSetChanged()
    }

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val name: TextView = view.findViewById(R.id.entryName)
        val username: TextView = view.findViewById(R.id.entryUsername)
        val btnDelete: ImageButton = view.findViewById(R.id.btnDelete)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_password, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val entry = entries[position]
        holder.name.text = entry.name
        holder.username.text = entry.username.ifBlank { entry.url }
        holder.btnDelete.setOnClickListener { onDelete(entry) }
    }

    override fun getItemCount() = entries.size
}
