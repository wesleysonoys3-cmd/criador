import 'package:flutter/foundation.dart';

class WalletModel extends ChangeNotifier {
  double _balance = 1000.0; // Saldo inicial generoso
  final List<String> _history = [];

  double get balance => _balance;
  List<String> get history => List.unmodifiable(_history);

  void addBalance(double amount, String description) {
    _balance += amount;
    _history.insert(0, '+ R\$ ${amount.toStringAsFixed(2)} - $description');
    notifyListeners();
  }

  bool subtractBalance(double amount, String description) {
    if (_balance >= amount) {
      _balance -= amount;
      _history.insert(0, '- R\$ ${amount.toStringAsFixed(2)} - $description');
      notifyListeners();
      return true;
    }
    return false;
  }
}
