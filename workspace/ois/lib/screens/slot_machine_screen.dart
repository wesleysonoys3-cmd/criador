import 'dart:math';
import 'package:flutter/material.dart';
import '../models/wallet_model.dart';

class SlotMachineScreen extends StatefulWidget {
  final WalletModel wallet;

  const SlotMachineScreen({Key? key, required this.wallet}) : super(key: key);

  @override
  State<SlotMachineScreen> createState() => _SlotMachineScreenState();
}

class _SlotMachineScreenState extends State<SlotMachineScreen> with SingleTickerProviderStateMixin {
  final List<String> symbols = ['🍒', '🍋', '🔔', '💎', ' 7️⃣ ', '⭐'];
  List<String> currentReels = ['🍒', '🍋', '🔔'];
  double betAmount = 10.0;
  String message = 'Gire para ganhar!';
  bool isSpinning = false;

  final Random random = Random();

  void spin() async {
    if (widget.wallet.balance < betAmount) {
      setState(() {
        message = 'Saldo insuficiente! Recarregue na carteira.';
      });
      return;
    }

    widget.wallet.subtractBalance(betAmount, 'Aposta Caça-Níquel');

    setState(() {
      isSpinning = true;
      message = 'Girando os cilindros...';
    });

    // Simula animação de giro
    for (int i = 0; i < 10; i++) {
      await Future.delayed(const Duration(milliseconds: 100));
      setState(() {
        currentReels = [
          symbols[random.nextInt(symbols.length)],
          symbols[random.nextInt(symbols.length)],
          symbols[random.nextInt(symbols.length)],
        ];
      });
    }

    // Resultado final
    setState(() {
      isSpinning = false;
      if (currentReels[0] == currentReels[1] && currentReels[1] == currentReels[2]) {
        double prize = betAmount * 10;
        widget.wallet.addBalance(prize, 'JACKPOT Caça-Níquel!');
        message = '🎉 JACKPOT! Você ganhou R\$ ${prize.toStringAsFixed(2)}!';
      } else if (currentReels[0] == currentReels[1] || currentReels[1] == currentReels[2] || currentReels[0] == currentReels[2]) {
        double prize = betAmount * 2;
        widget.wallet.addBalance(prize, 'Prêmio Parcial Caça-Níquel');
        message = '✨ Boa! Dois iguais! Ganhou R\$ ${prize.toStringAsFixed(2)}';
      } else {
        message = 'Não foi desta vez. Tente novamente!';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('🎰 Caça-Níquel Real'),
        backgroundColor: Colors.amber[900],
        actions: [
          Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16.0),
              child: Text(
                'Saldo: R\$ ${widget.wallet.balance.toStringAsFixed(2)}',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.amberAccent),
              ),
            ),
          )
        ],
      ),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [Colors.grey[900]!, Colors.purple[900]!],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Visor dos Cilindros
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: Colors.amber, width: 3),
                  boxShadow: [
                    BoxShadow(color: Colors.amber.withOpacity(0.4), blurRadius: 15, spreadRadius: 2)
                  ],
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: currentReels.map((symbol) {
                    return Container(
                      width: 80,
                      height: 100,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.amber[700]!, width: 2),
                      ),
                      child: Text(
                        symbol,
                        style: const TextStyle(fontSize: 48),
                      ),
                    );
                  }).toList(),
                ),
              ),
              const SizedBox(height: 30),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.amberAccent),
              ),
              const SizedBox(height: 30),
              // Seletor de Aposta
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('Valor da Aposta: ', style: TextStyle(color: Colors.white, fontSize: 16)),
                  DropdownButton<double>(
                    value: betAmount,
                    dropdownColor: Colors.grey[850],
                    style: const TextStyle(color: Colors.white, fontSize: 16),
                    items: [5.0, 10.0, 25.0, 50.0, 100.0].map((val) {
                      return DropdownMenuItem<double>(
                        value: val,
                        child: Text('R\$ $val'),
                      );
                    }).toList(),
                    onChanged: isSpinning ? null : (val) {
                      if (val != null) setState(() => betAmount = val);
                    },
                  ),
                ],
              ),
              const SizedBox(height: 30),
              // Botão Girar
              SizedBox(
                width: double.infinity,
                height: 55,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.amber[700],
                    foregroundColor: Colors.black,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    elevation: 8,
                  ),
                  onPressed: isSpinning ? null : spin,
                  child: Text(
                    isSpinning ? 'GIRANDO...' : 'GIRAR CILINDROS',
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
