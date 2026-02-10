/**
 * =================================================================================================
 * 💰 AOTRAVEL WALLET PROVIDER - TITANIUM FUSION ENGINE (FINAL RELEASE 2026)
 * =================================================================================================
 * ARQUIVO: lib/providers/wallet_provider.dart
 * DESCRIÇÃO: Motor financeiro sincronizado com wallet.js (Node.js).
 *            Gerencia Saldo Real, Transações P2P, Recargas, Levantamentos e Segurança.
 *
 * INTEGRAÇÃO:
 * - Backend: Node.js + PostgreSQL (ACID Transactions)
 * - Protocolo: RESTful API + Headers de Sessão
 * - Segurança: Validação de PIN e Token
 *
 * STATUS: PRODUCTION READY - FULL INTEGRITY - ZERO OMISSIONS
 * =================================================================================================
 */

import 'dart:convert';
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart'; // Para feedback tátil (HapticFeedback)
import 'package:http/http.dart' as http;
import 'auth_provider.dart';

// ===========================================================================
// 📦 TRANSACTION MODEL - MAPEAMENTO EXATO DO BANCO DE DADOS (POSTGRESQL)
// ===========================================================================

class TransactionModel {
  // --- CAMPOS NATIVOS DO BANCO DE DADOS (DB SCHEMA) ---
  final String id;
  final int? senderId;
  final int? receiverId;
  final double amount;
  final double fee;
  final String operationType; // Mapeado de 'type' no JSON
  final String? method;       // 'internal', 'iban', 'multicaixa', 'kwik'
  final String rawStatus;     // 'completed', 'pending', 'failed'
  final String description;
  final String referenceId;
  final Map<String, dynamic> metadata;
  final DateTime createdAt;

  // --- CAMPOS ENRIQUECIDOS (JOINED DATA) ---
  final String? senderName;
  final String? receiverName;
  final String? senderPhoto;
  final String? receiverPhoto;

  TransactionModel({
    required this.id,
    this.senderId,
    this.receiverId,
    required this.amount,
    required this.fee,
    required this.operationType,
    this.method,
    required this.rawStatus,
    required this.description,
    required this.referenceId,
    required this.metadata,
    required this.createdAt,
    this.senderName,
    this.receiverName,
    this.senderPhoto,
    this.receiverPhoto,
  });

  // --- FACTORY: PARSING DEFENSIVO E ROBUSTO ---
  factory TransactionModel.fromJson(Map<String, dynamic> json) {
    // Helper para parsear metadados que podem vir como String JSON ou Map
    Map<String, dynamic> parseMetadata(dynamic meta) {
      if (meta == null) return {};
      if (meta is Map) return Map<String, dynamic>.from(meta);
      if (meta is String) {
        try {
          return jsonDecode(meta);
        } catch (_) {
          return {};
        }
      }
      return {};
    }

    return TransactionModel(
      id: json['id']?.toString() ?? DateTime.now().millisecondsSinceEpoch.toString(),
      senderId: int.tryParse(json['sender_id']?.toString() ?? ''),
      receiverId: int.tryParse(json['receiver_id']?.toString() ?? ''),
      
      // O backend envia strings numéricas do PostgreSQL (Numeric/Decimal)
      amount: double.tryParse(json['amount']?.toString() ?? '0.0') ?? 0.0,
      fee: double.tryParse(json['fee']?.toString() ?? '0.0') ?? 0.0,
      
      operationType: json['type'] ?? 'unknown',
      method: json['method'],
      rawStatus: json['status'] ?? 'completed',
      description: json['description'] ?? 'Transação sem descrição',
      referenceId: json['reference_id'] ?? '',
      
      metadata: parseMetadata(json['metadata']),
      
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'])
          : DateTime.now(),
      
      // Dados de JOIN (Enriquecidos no Backend)
      senderName: json['sender_name'],
      receiverName: json['receiver_name'],
      senderPhoto: json['sender_photo'],
      receiverPhoto: json['receiver_photo'],
    );
  }

  // --- GETTERS DE APRESENTAÇÃO (UI LOGIC) ---

  /// Título formatado inteligente para a lista de histórico
  String get title {
    // Se a descrição do banco for clara, usa ela.
    if (description.isNotEmpty && description != 'Transação') {
      return description;
    }
    
    // Fallback lógico baseado no tipo de operação
    switch (operationType) {
      case 'topup': return 'Recarga de Carteira';
      case 'withdraw': return 'Levantamento Bancário';
      case 'ride_payment': return 'Pagamento de Corrida';
      case 'earnings': return 'Ganhos de Corrida';
      case 'transfer':
        // Lógica P2P: Se amount é positivo, recebi. Se negativo, enviei.
        if (amount > 0 && senderName != null) return 'Recebido de $senderName';
        if (amount < 0 && receiverName != null) return 'Enviado para $receiverName';
        return 'Transferência P2P';
      default: return 'Movimentação Financeira';
    }
  }

  /// Data formatada amigável (Hoje, Ontem, DD/MM/AAAA)
  String get date {
    final now = DateTime.now();
    final diff = now.difference(createdAt);

    if (diff.inDays == 0 && now.day == createdAt.day) {
      return "Hoje, ${createdAt.hour.toString().padLeft(2, '0')}:${createdAt.minute.toString().padLeft(2, '0')}";
    } else if (diff.inDays == 1 || (diff.inDays == 0 && now.day != createdAt.day)) {
      return "Ontem, ${createdAt.hour.toString().padLeft(2, '0')}:${createdAt.minute.toString().padLeft(2, '0')}";
    } else {
      return "${createdAt.day.toString().padLeft(2,'0')}/${createdAt.month.toString().padLeft(2,'0')}/${createdAt.year}";
    }
  }

  /// Define visualmente se é Entrada (credit) ou Saída (debit)
  /// Baseado na lógica do backend onde amount negativo é débito.
  String get type {
    // Tipos explicitamente de crédito (Recargas e Ganhos)
    if (['topup', 'earnings'].contains(operationType)) return 'credit';
    
    // Tipos explicitamente de débito (Saques e Pagamentos)
    if (['withdraw', 'ride_payment'].contains(operationType)) return 'debit';

    // Para transferências, olhamos o sinal do valor
    if (amount >= 0) return 'credit';
    return 'debit';
  }

  /// Verifica se está pendente
  bool get isPending => rawStatus == 'pending' || rawStatus == 'processing' || rawStatus == 'waiting_approval';
  
  /// Cor do status para UI
  Color get statusColor {
    switch (rawStatus) {
      case 'completed': return Colors.green;
      case 'pending': return const Color(0xFFFFB300); // Amber/Orange
      case 'failed': return Colors.red;
      case 'cancelled': return Colors.grey;
      default: return Colors.grey;
    }
  }

  /// Ícone correspondente à operação
  IconData get iconData {
    switch (operationType) {
      case 'topup': return Icons.add_circle_outline;
      case 'withdraw': return Icons.account_balance;
      case 'transfer': return amount >= 0 ? Icons.download : Icons.upload;
      case 'ride_payment': return Icons.directions_car;
      case 'earnings': return Icons.monetization_on;
      default: return Icons.compare_arrows;
    }
  }
}

// ===========================================================================
// 🛡️ WALLET PROVIDER - INTEGRAÇÃO FULL COM SERVER.JS / WALLET.JS
// ===========================================================================

class WalletProvider with ChangeNotifier {
  // --- CONFIGURAÇÃO DE INFRAESTRUTURA ---
  // URL de Produção Fixa (Backup caso a dinâmica falhe)
  final String _productionUrl = "https://aotravel.onrender.com/api";

  // --- ESTADO INTERNO (STATE MANAGEMENT) ---
  double _balance = 0.0;
  String _iban = "AO06 ...";
  int _bonusPoints = 0;
  double _accountLimit = 500000.0;
  bool _hasPin = false; // Indica se o usuário já definiu PIN
  String _currency = "AOA";

  List<TransactionModel> _transactions = [];
  List<Map<String, dynamic>> _externalAccounts = [];
  
  // Controle de Estado da UI
  bool _isLoading = false;
  String? _errorMessage;
  String? _successMessage;

  // --- GETTERS PÚBLICOS ---
  double get balance => _balance;
  String get iban => _iban;
  int get bonusPoints => _bonusPoints;
  double get accountLimit => _accountLimit;
  bool get hasPin => _hasPin;
  String get currency => _currency;
  
  List<TransactionModel> get transactions => _transactions;
  List<Map<String, dynamic>> get externalAccounts => _externalAccounts;
  
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  String? get successMessage => _successMessage;

  // --- HELPERS INTERNOS DE CONEXÃO ---
  
  /// Constrói a URL correta baseada no AuthProvider (Dev vs Prod)
  /// Remove '/auth' da URL base do AuthProvider para obter a raiz da API.
  String _getApiUrl(AuthProvider auth) {
    if (auth.baseUrl.isNotEmpty) {
      return auth.baseUrl.replaceAll('/auth', ''); 
    }
    return _productionUrl;
  }

  /// Gera Headers Padrão com Token de Sessão e Controle de Versão
  Map<String, String> _headers(AuthProvider auth) {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer ${auth.sessionToken ?? ''}', // Bearer Token Standard
      'x-session-token': auth.sessionToken ?? '',           // Custom Header Legacy
      'x-app-version': '3.0.0-titanium'                     // Version Control
    };
  }

  /// Limpa mensagens de erro/sucesso para resetar a UI
  void clearMessages() {
    _errorMessage = null;
    _successMessage = null;
    notifyListeners();
  }

  // ===========================================================================
  // ⚡ CORE METHODS (API CALLS & BUSINESS LOGIC)
  // ===========================================================================

  /// 1. CARREGAR CARTEIRA COMPLETA (Sync Engine)
  /// Rota: GET /api/wallet
  /// Descrição: Busca saldo real, transações e contas vinculadas em uma única chamada otimizada.
  Future<void> loadWalletData(AuthProvider auth) async {
    // 1. Validação de Sessão
    if (!auth.isAuthenticated) {
      _errorMessage = "Sessão expirada. Faça login novamente.";
      notifyListeners();
      return;
    }

    _isLoading = true;
    _errorMessage = null;
    // Não notificamos aqui para evitar flicker na UI se já tiver dados
    // notifyListeners(); 

    try {
      final url = Uri.parse('${_getApiUrl(auth)}/wallet');
      debugPrint("🔄 [WALLET] Iniciando sincronização: $url");

      final response = await http.get(url, headers: _headers(auth))
          .timeout(const Duration(seconds: 25));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);

        // A. Sincronizar Dados da Carteira (Source of Truth)
        if (data['wallet'] != null) {
          _balance = double.tryParse(data['wallet']['balance']?.toString() ?? '0.0') ?? 0.0;
          _iban = data['wallet']['iban'] ?? "AO06 ...";
          _bonusPoints = int.tryParse(data['wallet']['bonus_points']?.toString() ?? '0') ?? 0;
          _accountLimit = double.tryParse(data['wallet']['limit']?.toString() ?? '500000') ?? 500000.0;
          _hasPin = data['wallet']['has_pin'] == true;
          _currency = data['wallet']['currency'] ?? "AOA";
          
          // Propaga o saldo real para o AuthProvider (cache global para outras telas)
          auth.syncBalance(_balance);
        }

        // B. Contas Externas Salvas
        if (data['external_accounts'] != null) {
          _externalAccounts = List<Map<String, dynamic>>.from(data['external_accounts']);
        }

        // C. Histórico de Transações
        if (data['transactions'] != null) {
          _transactions = (data['transactions'] as List)
              .map((tx) => TransactionModel.fromJson(tx))
              .toList();
        }

        debugPrint("✅ [WALLET] Sincronização concluída. Saldo Real: $_balance $_currency");

      } else {
        // Tratamento de erros HTTP (4xx, 5xx)
        try {
          final errorData = jsonDecode(response.body);
          _errorMessage = errorData['error'] ?? "Erro do servidor (${response.statusCode})";
        } catch (_) {
          _errorMessage = "Falha ao carregar carteira (${response.statusCode})";
        }
        debugPrint("⚠️ [WALLET_ERROR] ${response.body}");
      }
    } on SocketException {
      _errorMessage = "Sem conexão com a internet. Verifique sua rede.";
    } on TimeoutException {
      _errorMessage = "Tempo limite excedido. O servidor demorou a responder.";
    } catch (e) {
      debugPrint("❌ [WALLET_CRITICAL] Exception: $e");
      _errorMessage = "Erro interno no aplicativo.";
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 2. TRANSFERÊNCIA P2P (Internal Transfer)
  /// Rota: POST /api/wallet/transfer/internal
  /// Descrição: Envia dinheiro para outro usuário usando PIN de segurança.
  Future<bool> transferP2P({
    required AuthProvider auth,
    required String targetContact, // Email, Phone ou IBAN
    required double amount,
    required String pin,
    String description = "Transferência P2P",
  }) async {
    // 1. Pré-validações Locais
    if (amount <= 0) {
      _errorMessage = "O valor deve ser maior que zero.";
      notifyListeners();
      return false;
    }
    if (amount > _balance) {
      _errorMessage = "Saldo insuficiente para esta operação.";
      notifyListeners();
      return false;
    }

    _isLoading = true;
    _errorMessage = null;
    _successMessage = null;
    notifyListeners();

    try {
      final url = Uri.parse('${_getApiUrl(auth)}/wallet/transfer/internal');
      
      final body = {
        'receiver_identifier': targetContact,
        'amount': amount,
        'description': description,
        'pin': pin
      };

      debugPrint("💸 [WALLET] Enviando P2P: $amount para $targetContact");

      final response = await http.post(
        url,
        headers: _headers(auth),
        body: jsonEncode(body)
      ).timeout(const Duration(seconds: 40)); // Timeout maior para transações

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        _successMessage = "Transferência realizada com sucesso!";
        HapticFeedback.heavyImpact();
        
        // Recarrega tudo para garantir consistência dos dados
        await loadWalletData(auth); 
        return true;
      } else {
        _errorMessage = data['error'] ?? data['message'] ?? "A transação foi recusada.";
        HapticFeedback.vibrate();
        return false;
      }
    } catch (e) {
      _errorMessage = "Erro na transferência: Verifique sua conexão.";
      debugPrint("❌ [WALLET_P2P_ERROR] $e");
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 3. SOLICITAR PAGAMENTO (Request Money)
  /// Rota: POST /api/wallet/request-payment
  /// Descrição: Envia notificação para outro usuário pedindo valor.
  Future<bool> requestPayment({
    required AuthProvider auth,
    required String targetIdentifier,
    required double amount,
    String description = "Solicitação de Pagamento"
  }) async {
    if (amount <= 0) {
        _errorMessage = "Valor inválido.";
        notifyListeners();
        return false;
    }

    _isLoading = true;
    notifyListeners();

    try {
      final url = Uri.parse('${_getApiUrl(auth)}/wallet/request-payment');
      
      final response = await http.post(
        url, 
        headers: _headers(auth), 
        body: jsonEncode({
          'target_identifier': targetIdentifier,
          'amount': amount,
          'description': description
        })
      ).timeout(const Duration(seconds: 20));

      final data = jsonDecode(response.body);

      if (response.statusCode == 200) {
        _successMessage = "Solicitação enviada com sucesso.";
        _isLoading = false;
        notifyListeners();
        return true;
      } else {
        _errorMessage = data['error'] ?? "Não foi possível enviar a solicitação.";
        _isLoading = false;
        notifyListeners();
        return false;
      }
    } catch (e) {
      _errorMessage = "Erro de conexão ao solicitar pagamento.";
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// 4. RECARGA DE CARTEIRA (Top-Up)
  /// Rota: POST /api/wallet/topup
  /// Descrição: Inicia processo de recarga via Multicaixa ou Gateway.
  Future<bool> topUp({
    required AuthProvider auth,
    required double amount,
    required String method, // 'multicaixa', 'visa'
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final url = Uri.parse('${_getApiUrl(auth)}/wallet/topup');
      
      final response = await http.post(
        url,
        headers: _headers(auth),
        body: jsonEncode({
          'amount': amount,
          'method': method,
          // Gera um ID de transação local para rastreamento (opcional)
          'transaction_id': 'APP-${DateTime.now().millisecondsSinceEpoch}'
        })
      ).timeout(const Duration(seconds: 30));

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 || response.statusCode == 201) {
        _successMessage = data['message'] ?? "Recarga efetuada com sucesso.";
        
        // Se o backend retornar o novo saldo imediatamente (Simulação/Instantâneo)
        if (data['new_balance'] != null) {
          _balance = double.tryParse(data['new_balance'].toString()) ?? _balance;
          auth.syncBalance(_balance);
          
          // Adiciona transação simulada à lista se o backend não retornou a lista atualizada
          // Isso melhora a UX (feedback instantâneo)
          await loadWalletData(auth); 
        }
        
        return true;
      } else {
        _errorMessage = data['error'] ?? "Falha na recarga.";
        return false;
      }
    } catch (e) {
      // Fallback gracioso
      _errorMessage = "Serviço de recarga indisponível temporariamente.";
      debugPrint("❌ [WALLET_TOPUP_ERROR] $e");
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 5. LEVANTAMENTO / SAQUE (Withdraw)
  /// Rota: POST /api/wallet/withdraw
  /// Descrição: Solicita retirada de fundos para conta bancária.
  Future<bool> withdraw({
    required AuthProvider auth,
    required double amount,
    required String iban,
    String? description,
  }) async {
    if (amount > _balance) {
      _errorMessage = "Saldo insuficiente para levantamento.";
      notifyListeners();
      return false;
    }

    // Regra de Negócio: Mínimo 2000 Kz (Espelhando o Backend)
    if (amount < 2000) {
      _errorMessage = "Valor mínimo de levantamento é 2.000 Kz.";
      notifyListeners();
      return false;
    }

    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final url = Uri.parse('${_getApiUrl(auth)}/wallet/withdraw');
      
      final response = await http.post(
        url,
        headers: _headers(auth),
        body: jsonEncode({
          'amount': amount,
          'destination_iban': iban,
          'bank_details': { // Objeto esperado pelo backend
             'account_number': iban,
             'bank_name': 'Banco Externo'
          },
          'description': description ?? "Levantamento AOtravel",
        })
      ).timeout(const Duration(seconds: 30));

      final data = jsonDecode(response.body);

      if (response.statusCode == 200) {
        _successMessage = "Levantamento solicitado. Aguarde aprovação.";
        HapticFeedback.mediumImpact();
        
        // Deduz saldo visualmente até o refresh real
        _balance -= amount;
        auth.syncBalance(_balance);
        
        // Recarrega para obter o status 'pending' correto do servidor
        await loadWalletData(auth);

        return true;
      } else {
        _errorMessage = data['error'] ?? "Erro ao processar levantamento.";
        return false;
      }
    } catch (e) {
      _errorMessage = "Erro de conexão com o servidor.";
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 6. ADICIONAR CONTA BANCÁRIA
  /// Rota: POST /api/wallet/accounts/add
  Future<bool> addExternalAccount(
    AuthProvider auth, {
    required String providerName,
    required String accountNumber,
    required String holderName,
  }) async {
    _isLoading = true;
    notifyListeners();

    try {
      final url = Uri.parse('${_getApiUrl(auth)}/wallet/accounts/add');
      
      final response = await http.post(
        url,
        headers: _headers(auth),
        body: jsonEncode({
          'provider': providerName,
          'account_number': accountNumber,
          'holder_name': holderName
        })
      ).timeout(const Duration(seconds: 20));

      if (response.statusCode == 200) {
        _successMessage = "Conta adicionada com sucesso.";
        await loadWalletData(auth); // Atualiza a lista de contas
        return true;
      } else {
        final data = jsonDecode(response.body);
        _errorMessage = data['error'] ?? "Erro ao adicionar conta.";
        return false;
      }
    } catch (e) {
      _errorMessage = "Erro de conexão.";
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 7. REMOVER CONTA BANCÁRIA
  /// Rota: DELETE /api/wallet/accounts/:id
  Future<bool> deleteExternalAccount(AuthProvider auth, int accountId) async {
    _isLoading = true;
    notifyListeners();

    try {
      final url = Uri.parse('${_getApiUrl(auth)}/wallet/accounts/$accountId');
      
      final response = await http.delete(
        url,
        headers: _headers(auth),
      );

      if (response.statusCode == 200) {
        _successMessage = "Conta removida.";
        // Remove localmente para UI instantânea
        _externalAccounts.removeWhere((acc) => acc['id'] == accountId);
        return true;
      } else {
        _errorMessage = "Erro ao remover conta.";
        return false;
      }
    } catch (e) {
      _errorMessage = "Erro de conexão.";
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 8. VERIFICAR PIN (Segurança UI)
  /// Rota: POST /api/wallet/verify-pin
  Future<bool> verifyPin(AuthProvider auth, String pin) async {
    _isLoading = true;
    notifyListeners();

    try {
      final url = Uri.parse('${_getApiUrl(auth)}/wallet/verify-pin');
      
      final response = await http.post(
        url,
        headers: _headers(auth),
        body: jsonEncode({'pin': pin})
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['valid'] == true) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 9. CONFIGURAR PIN
  /// Rota: POST /api/wallet/set-pin
  Future<bool> setPin(AuthProvider auth, String newPin, {String? currentPin}) async {
    _isLoading = true;
    notifyListeners();

    try {
      final url = Uri.parse('${_getApiUrl(auth)}/wallet/set-pin');
      
      final response = await http.post(
        url,
        headers: _headers(auth),
        body: jsonEncode({
          'new_pin': newPin,
          'current_pin': currentPin
        })
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        _successMessage = "PIN configurado com sucesso.";
        _hasPin = true;
        return true;
      } else {
        _errorMessage = data['error'] ?? "Erro ao configurar PIN.";
        return false;
      }
    } catch (e) {
      _errorMessage = "Erro de conexão.";
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // ===========================================================================
  // 🔌 ADAPTADORES DE COMPATIBILIDADE (LEGACY SUPPORT)
  // Mantidos para garantir que chamadas antigas da UI não quebrem o app.
  // ===========================================================================

  /// Alias para transferP2P (Usado em telas antigas)
  Future<bool> transferFunds(
    AuthProvider auth, {
    required String targetIbanOrPhone,
    required double amount,
    required String pin,
    String? description,
  }) async {
    return await transferP2P(
      auth: auth,
      targetContact: targetIbanOrPhone,
      amount: amount,
      pin: pin,
      description: description ?? "Transferência"
    );
  }

  /// Alias para recarregar dados (Usado em telas antigas)
  Future<void> refreshWallet([AuthProvider? auth]) async {
    if (auth != null) {
      await loadWalletData(auth);
    } else {
      debugPrint("⚠️ [WalletProvider] refreshWallet chamado sem AuthProvider.");
    }
  }
}
