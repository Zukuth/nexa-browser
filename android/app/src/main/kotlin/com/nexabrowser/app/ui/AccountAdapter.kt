package com.nexabrowser.app.ui

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.nexabrowser.app.R
import com.nexabrowser.app.data.Account

class AccountAdapter(
    private val onOpen: (Account) -> Unit,
    private val onDelete: (Account) -> Unit,
    private val onEdit: (Account) -> Unit
) : RecyclerView.Adapter<AccountAdapter.ViewHolder>() {

    private var accounts: List<Account> = emptyList()

    fun submit(newAccounts: List<Account>) {
        accounts = newAccounts
        notifyDataSetChanged()
    }

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val swatch: View = view.findViewById(R.id.colorSwatch)
        val name: TextView = view.findViewById(R.id.accountName)
        val url: TextView = view.findViewById(R.id.accountUrl)
        val btnDelete: ImageButton = view.findViewById(R.id.btnDelete)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_account, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val account = accounts[position]
        holder.name.text = account.name
        holder.url.text = account.url
        val drawable = (holder.swatch.background.mutate() as GradientDrawable)
        drawable.setColor(runCatching { Color.parseColor(account.colorHex) }.getOrDefault(Color.parseColor("#4F8CFF")))
        holder.itemView.setOnClickListener { onOpen(account) }
        holder.itemView.setOnLongClickListener { onEdit(account); true }
        holder.btnDelete.setOnClickListener { onDelete(account) }
    }

    override fun getItemCount() = accounts.size
}
