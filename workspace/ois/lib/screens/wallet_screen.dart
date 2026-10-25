import 'package:flutter/material.dart';
import '../models/wallet_model.dart';

class WalletScreen extends StatelessWidget {
  final WalletModel wallet;

  const WalletScreen({Key? key, required this.wallet}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('💰 Caixa & Carteira'),
        backgroundColor: Colors.grey[900],
      ),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [Colors.black, Colors.grey[900]!],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.grey[850],
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.amber, width: 2),
                ),
                child: Column(
                  children: [
                    const Text('Seu Saldo Disponível', style: TextStyle(color: Colors.white70, fontSize: 16)),
                    const SizedBox(height: 10),
                    Text(
                      'R\$ ${wallet.balance.toStringAsFixed(2)}',
                      style: const TextStyle(color: Colors.amberAccent, fontSize: 36, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 20),
                    ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.amber,
                        foregroundColor: Colors.black,
                      ),
                      onPressed: () {
                        wallet.addBalance(100.0, 'Recarga Bônus de Fichas');
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('R\$ 100.00 adicionados com sucesso!')),
                        );
                      },
                      icon: const Icon(Icons.add_circle),
                      label: const Text('RECARREGAR +R\$ 100', style: TextStyle(fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 30),
              const Text('Histórico de Transações', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 10),
              Expanded(
                child: ListView.builder(
                  itemCount: wallet.history.length,
                  itemBuilder: (context, index) {
                    final item = wallet.history[index];
                    final isPositive = item.startsWith('+');
                    return Card(
                      color: Colors.grey[850],
                      child: ListTile(
                        leading: Icon(
                          isPositive ? Icons.arrow_downward : Icons.arrow_upward,
                          color: isPositive ? Colors.green : Colors.red,
                        ),
                        title: Text(item, style: const TextStyle(color: Colors.white)),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
