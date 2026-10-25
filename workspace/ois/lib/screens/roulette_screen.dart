import 'dart:math';
import 'package:flutter/material.dart';
import '../models/wallet_model.dart';

class RouletteScreen extends StatefulWidget {
  final WalletModel wallet;

  const RouletteScreen({Key? key, required this.wallet}) : super(key: key);

  @override
  State<RouletteScreen> createState() => _RouletteScreenState();
}

class _RouletteScreenState extends State<RouletteScreen> {
  double betAmount = 20.0;
  String selectedBetType = 'red'; // 'red', 'black', 'green'
  int? winningNumber;
  String message = 'Faça sua aposta na Roleta!';
  bool isSpinning = false;

  final Random random = Random();

  void spinRoulette() async {
    if (widget.wallet.balance < betAmount) {
      setState(() {
        message = 'Saldo insuficiente!';
      });
      return;
    }

    widget.wallet.subtractBalance(betAmount, 'Aposta Roleta ($selectedBetType)');

    setState(() {
      isSpinning = true;
      message = 'A roleta está girando... 🎡';
    });

    await Future.delayed(const Duration(seconds: 2));

    int resultNum = random.nextInt(37); // 0 a 36
    String resultColor;
    if (resultNum == 0) {
      resultColor = 'green';
    } else if (resultNum % 2 == 0) {
      resultColor = 'black'; // Simplificado
    } else {
      resultColor = 'red';
    }

    bool won = false;
    double prize = 0;

    if (selectedBetType == resultColor) {
      won = true;
      prize = resultColor == 'green' ? betAmount * 14 : betAmount * 2;
      widget.wallet.addBalance(prize, 'Vitória na Roleta');
    }

    setState(() {
      isSpinning = false;
      winningNumber = resultNum;
      if (won) {
        message = '🎯 Número sorteado: $resultNum ($resultColor). Você ganhou R\$ ${prize.toStringAsFixed(2)}!';
      } else {
        message = '❌ Número sorteado: $resultNum ($resultColor). Não foi dessa vez!';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('🎯 Roleta da Sorte'),
        backgroundColor: Colors.red[900],
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
            colors: [Colors.grey[900]!, Colors.red[900]!],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 150,
                height: 150,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: winningNumber == null
                      ? Colors.grey[800]
                      : (winningNumber == 0
                          ? Colors.green
                          : (winningNumber! % 2 == 0 ? Colors.black : Colors.red)),
                  border: Border.all(color: Colors.amber, width: 4),
                  boxShadow: [BoxShadow(color: Colors.black45, blurRadius: 10)],
                ),
                alignment: Alignment.center,
                child: Text(
                  winningNumber == null ? '🎡' : '$winningNumber',
                  style: const TextStyle(fontSize: 40, fontWeight: FontWeight.bold, color: Colors.white),
                ),
              ),
              const SizedBox(height: 30),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
              ),
              const SizedBox(height: 30),
              // Opções de Aposta
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  ChoiceChip(
                    label: const Text('Vermelho (2x)'),
                    selected: selectedBetType == 'red',
                    selectedColor: Colors.red,
                    backgroundColor: Colors.grey[800],
                    labelStyle: const TextStyle(color: Colors.white),
                    onSelected: (val) => setState(() => selectedBetType = 'red'),
                  ),
                  const SizedBox(width: 10),
                  ChoiceChip(
                    label: const Text('Preto (2x)'),
                    selected: selectedBetType == 'black',
                    selectedColor: Colors.black,
                    backgroundColor: Colors.grey[800],
                    labelStyle: const TextStyle(color: Colors.white),
                    onSelected: (val) => setState(() => selectedBetType = 'black'),
                  ),
                  const SizedBox(width: 10),
                  ChoiceChip(
                    label: const Text('Zero (14x)'),
                    selected: selectedBetType == 'green',
                    selectedColor: Colors.green,
                    backgroundColor: Colors.grey[800],
                    labelStyle: const TextStyle(color: Colors.white),
                    onSelected: (val) => setState(() => selectedBetType = 'green'),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('Aposta: ', style: TextStyle(color: Colors.white, fontSize: 16)),
                  DropdownButton<double>(
                    value: betAmount,
                    dropdownColor: Colors.grey[850],
                    style: const TextStyle(color: Colors.white, fontSize: 16),
                    items: [10.0, 20.0, 50.0, 100.0].map((val) {
                      return DropdownMenuItem<double>(value: val, child: Text('R\$ $val'));
                    }).toList(),
                    onChanged: isSpinning ? null : (val) => setState(() => betAmount = val!),
                  ),
                ],
              ),
              const SizedBox(height: 30),
              SizedBox(
                width: double.infinity,
                height: 55,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.red[700],
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: isSpinning ? null : spinRoulette,
                  child: Text(
                    isSpinning ? 'GIRANDO...' : 'GIRAR ROLETA',
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
