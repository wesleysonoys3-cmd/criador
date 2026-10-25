import 'dart:math';
import 'package:flutter/material.dart';
import '../models/wallet_model.dart';

class BlackjackScreen extends StatefulWidget {
  final WalletModel wallet;

  const BlackjackScreen({Key? key, required this.wallet}) : super(key: key);

  @override
  State<BlackjackScreen> createState() => _BlackjackScreenState();
}

class _BlackjackScreenState extends State<BlackjackScreen> {
  double betAmount = 25.0;
  List<int> playerHand = [];
  List<int> dealerHand = [];
  bool gameStarted = false;
  String message = 'Faça sua aposta para iniciar o Blackjack!';

  final Random random = Random();

  int calculateScore(List<int> hand) {
    int score = hand.fold(0, (sum, card) => sum + (card > 10 ? 10 : card));
    return score;
  }

  void startRound() {
    if (widget.wallet.balance < betAmount) {
      setState(() => message = 'Saldo insuficiente!');
      return;
    }

    widget.wallet.subtractBalance(betAmount, 'Aposta Blackjack');

    setState(() {
      gameStarted = true;
      playerHand = [random.nextInt(10) + 1, random.nextInt(10) + 1];
      dealerHand = [random.nextInt(10) + 1, random.nextInt(10) + 1];
      message = 'Sua vez de jogar!';
    });
  }

  void hit() {
    setState(() {
      playerHand.add(random.nextInt(10) + 1);
      if (calculateScore(playerHand) > 21) {
        gameStarted = false;
        message = '💥 Estourou! Você ultrapassou 21 pontos.';
      }
    });
  }

  void stand() {
    int dealerScore = calculateScore(dealerHand);
    while (dealerScore < 17) {
      dealerHand.add(random.nextInt(10) + 1);
      dealerScore = calculateScore(dealerHand);
    }

    int playerScore = calculateScore(playerHand);
    setState(() {
      gameStarted = false;
      if (dealerScore > 21 || playerScore > dealerScore) {
        double prize = betAmount * 2;
        widget.wallet.addBalance(prize, 'Vitória no Blackjack');
        message = '🏆 Você venceu! (Você: $playerScore vs Dealer: $dealerScore). Ganhou R\$ ${prize.toStringAsFixed(2)}';
      } else if (playerScore == dealerScore) {
        widget.wallet.addBalance(betAmount, 'Empate Blackjack (Push)');
        message = '🤝 Empate (Push)! Aposta devolvida.';
      } else {
        message = '❌ Dealer venceu! (Você: $playerScore vs Dealer: $dealerScore)';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('🃏 Blackjack (21)'),
        backgroundColor: Colors.green[900],
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
            colors: [Colors.grey[900]!, Colors.green[900]!],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Dealer
              const Text('Mão do Dealer', style: TextStyle(color: Colors.white70, fontSize: 16)),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: dealerHand.map((c) => CardWidget(card: c)).toList(),
              ),
              const SizedBox(height: 30),
              // Player
              const Text('Sua Mão', style: TextStyle(color: Colors.amberAccent, fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: playerHand.map((c) => CardWidget(card: c)).toList(),
              ),
              const SizedBox(height: 20),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
              ),
              const SizedBox(height: 30),
              if (!gameStarted) ...[
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('Aposta: ', style: TextStyle(color: Colors.white, fontSize: 16)),
                    DropdownButton<double>(
                      value: betAmount,
                      dropdownColor: Colors.grey[850],
                      style: const TextStyle(color: Colors.white, fontSize: 16),
                      items: [10.0, 25.0, 50.0, 100.0].map((val) {
                        return DropdownMenuItem<double>(value: val, child: Text('R\$ $val'));
                      }).toList(),
                      onChanged: (val) => setState(() => betAmount = val!),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(backgroundColor: Colors.green[700], foregroundColor: Colors.white),
                    onPressed: startRound,
                    child: const Text('DISTRIBUIR CARTAS', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  ),
                ),
              ] else ...[
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(backgroundColor: Colors.blue[700], foregroundColor: Colors.white),
                        onPressed: hit,
                        child: const Text('PEDIR (HIT)', style: TextStyle(fontSize: 16)),
                      ),
                    ),
                    const SizedBox(width: 15),
                    Expanded(
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(backgroundColor: Colors.orange[800], foregroundColor: Colors.white),
                        onPressed: stand,
                        child: const Text('PARAR (STAND)', style: TextStyle(fontSize: 16)),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class CardWidget extends StatelessWidget {
  final int card;
  const CardWidget({Key? key, required this.card}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 50,
      height: 70,
      margin: const EdgeInsets.symmetric(horizontal: 5),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.black, width: 2),
      ),
      alignment: Alignment.center,
      child: Text(
        '$card',
        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.black87),
      ),
    );
  }
}
