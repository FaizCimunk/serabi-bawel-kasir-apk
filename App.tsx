import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  StatusBar,
  SafeAreaView,
  BackHandler,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  Platform,
  PermissionsAndroid,
  Alert,
} from 'react-native';
import { WebView as RawWebView } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';
import RNBluetoothClassic, { BluetoothDevice } from 'react-native-bluetooth-classic';
import { 
  Printer, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Settings, 
  X, 
  ChevronRight, 
  Zap 
} from 'lucide-react-native';

const WebView: any = RawWebView;

// URL Layar Kasir POS Resmi di Cloudflare Pages
const POS_URL = 'https://pak-agan-pos.pages.dev/pos';

export default function App() {
  const webViewRef = useRef<any>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [webViewLoading, setWebViewLoading] = useState(true);

  // Bluetooth Printer State
  const connectedPrinterRef = useRef<BluetoothDevice | null>(null);
  const [printerConnected, setPrinterConnected] = useState(false);
  const [printerName, setPrinterName] = useState<string>('Belum Terhubung');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [devicesList, setDevicesList] = useState<{ name: string; address: string }[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectingAddress, setConnectingAddress] = useState<string | null>(null);

  // Minta Izin Bluetooth Android
  const requestBluetoothPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      if (Platform.Version >= 31) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return (
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      console.warn('Bluetooth permission error:', err);
      return false;
    }
  };

  // Auto-connect ke printer terakhir yang tersimpan saat aplikasi dibuka
  useEffect(() => {
    async function initPrinter() {
      try {
        if (Platform.OS === 'android') {
          const savedMac = await SecureStore.getItemAsync('serabi_saved_printer_mac');
          const savedName = await SecureStore.getItemAsync('serabi_saved_printer_name');
          if (savedMac) {
            setPrinterName(savedName || 'Printer Thermal');
            const isEnabled = await RNBluetoothClassic.isBluetoothEnabled();
            if (isEnabled) {
              const device = await RNBluetoothClassic.connectToDevice(savedMac);
              connectedPrinterRef.current = device;
              setPrinterConnected(true);
              setPrinterName(device.name || savedName || 'Printer Thermal');
            }
          }
        }
      } catch (e) {
        console.log('Printer belum menyala saat start.');
      }
    }
    initPrinter();
  }, []);

  // Handle Tombol Back Fisik Android agar tidak keluar dari kasir
  useEffect(() => {
    const onBackPress = () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      Alert.alert(
        'Keluar dari Kasir?',
        'Apakah Anda yakin ingin menutup aplikasi kasir Serabi Bawel?',
        [
          { text: 'Batal', style: 'cancel' },
          { text: 'Keluar', style: 'destructive', onPress: () => BackHandler.exitApp() },
        ]
      );
      return true;
    };

    BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => BackHandler.removeEventListener('hardwareBackPress', onBackPress);
  }, [canGoBack]);

  // Scan Perangkat Bluetooth yang sudah di-pair di Android
  const loadPairedDevices = async () => {
    setScanning(true);
    try {
      const hasPerm = await requestBluetoothPermissions();
      if (!hasPerm) {
        Alert.alert('Izin Dibutuhkan', 'Harap izinkan akses Bluetooth di Pengaturan HP Anda.');
        setScanning(false);
        return;
      }

      const enabled = await RNBluetoothClassic.isBluetoothEnabled();
      if (!enabled) {
        try {
          await RNBluetoothClassic.requestBluetoothEnabled();
        } catch {
          Alert.alert('Bluetooth Mati', 'Harap nyalakan Bluetooth pada tablet kasir.');
          setScanning(false);
          return;
        }
      }

      const bonded = await RNBluetoothClassic.getBondedDevices();
      const list = bonded.map((d: any) => ({
        name: d.name || 'Printer Bluetooth',
        address: d.address,
      }));
      setDevicesList(list);
    } catch (err: any) {
      Alert.alert('Error Scan', err.message || 'Gagal memuat perangkat Bluetooth.');
    } finally {
      setScanning(false);
    }
  };

  // Sambungkan ke Printer Tertentu
  const connectToPrinter = async (macAddress: string, name: string) => {
    setConnectingAddress(macAddress);
    try {
      if (connectedPrinterRef.current) {
        try {
          await connectedPrinterRef.current.disconnect();
        } catch {}
        connectedPrinterRef.current = null;
      }

      const device = await RNBluetoothClassic.connectToDevice(macAddress);
      connectedPrinterRef.current = device;
      setPrinterConnected(true);
      setPrinterName(name || device.name || 'Printer Thermal');

      await SecureStore.setItemAsync('serabi_saved_printer_mac', macAddress);
      await SecureStore.setItemAsync('serabi_saved_printer_name', name || device.name || 'Printer Thermal');

      Alert.alert('Berhasil', `Terhubung ke printer: ${name || device.name}`);
      setIsModalOpen(false);
    } catch (err: any) {
      Alert.alert('Gagal Konek', err.message || 'Pastikan printer Bluetooth menyala.');
    } finally {
      setConnectingAddress(null);
    }
  };

  // Test Print Struk 58mm
  const handleTestPrint = async () => {
    let device = connectedPrinterRef.current;
    if (!device) {
      Alert.alert('Perhatian', 'Printer belum terhubung. Pilih printer terlebih dahulu.');
      return;
    }

    try {
      const ESC = '\x1B';
      const GS = '\x1D';

      let p = ESC + '@'; // Reset
      p += ESC + 'a\x01'; // Center
      p += ESC + 'E\x01'; // Bold
      p += 'SERABI BAWEL & WEDANG GEPREK\n';
      p += ESC + 'E\x00'; // Normal
      p += 'Test Cetak Printer Thermal 58mm\n';
      p += '--------------------------------\n';
      p += ESC + 'a\x00'; // Left
      p += `Waktu: ${new Date().toLocaleTimeString('id-ID')}\n`;
      p += 'Status: KONEKSI NATIVE APK BERHASIL!\n';
      p += '--------------------------------\n';
      p += ESC + 'a\x01'; // Center
      p += 'ivokgrup Digital POS System\n';
      p += '\n\n\n\n'; // Feed
      p += GS + 'V\x41\x03'; // Cut

      await device.write(p, 'ascii');
      Alert.alert('Sukses', 'Perintah cetak terkirim ke printer!');
    } catch (e: any) {
      Alert.alert('Gagal Cetak', e.message || 'Gagal mengirim data ke printer.');
    }
  };

  // Terima pesan dari halaman POS Next.js via postMessage
  const handleWebViewMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.type === 'BT_PRINT_RECEIPT') {
        let device = connectedPrinterRef.current;
        let isConn = false;
        if (device) {
          isConn = await device.isConnected();
        }

        // Auto-reconnect jika sempat terputus
        if (!isConn) {
          const savedMac = await SecureStore.getItemAsync('serabi_saved_printer_mac');
          if (savedMac) {
            try {
              device = await RNBluetoothClassic.connectToDevice(savedMac);
              connectedPrinterRef.current = device;
              isConn = true;
              setPrinterConnected(true);
            } catch (reconErr) {
              console.warn('Auto reconnect printer failed:', reconErr);
            }
          }
        }

        if (!isConn || !device) {
          Alert.alert(
            'Printer Belum Terhubung',
            'Silakan klik tombol Printer di pojok atas untuk menyambungkan printer Bluetooth Anda.'
          );
          return;
        }

        // Kirim string cetak ESC/POS langsung ke printer Bluetooth
        const ESC = '\x1B';
        const GS = '\x1D';

        let payload = '';
        if (data.openDrawer) {
          payload += ESC + 'p\x00\x19\xFA'; // Sinyal buka laci kasir RJ11
        }
        payload += (data.text || '');
        payload += '\n\n\n\n';
        payload += GS + 'V\x41\x03'; // Cut

        await device.write(payload, 'ascii');
      } else if (data.type === 'BT_GET_PAIRED_DEVICES') {
        loadPairedDevices();
      }
    } catch (err) {
      console.warn('Bridge Message Error:', err);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar backgroundColor="#064E3B" barStyle="light-content" />

      {/* HEADER BAR TAKTIL KHUSUS KASIR TABLET */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <Text style={styles.brandText}>🥞 SERABI BAWEL</Text>
          <View style={styles.pillBadge}>
            <Text style={styles.pillText}>APK KASIR RESMI</Text>
          </View>
        </View>

        {/* STATUS PRINTER BLUETOOTH */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[
              styles.printerStatusButton,
              printerConnected ? styles.printerConnectedBg : styles.printerDisconnectedBg,
            ]}
            onPress={() => {
              loadPairedDevices();
              setIsModalOpen(true);
            }}
          >
            <Printer size={15} color={printerConnected ? '#064E3B' : '#DC2626'} />
            <Text
              style={[
                styles.printerStatusText,
                { color: printerConnected ? '#064E3B' : '#DC2626' },
              ]}
              numberOfLines={1}
            >
              {printerConnected ? printerName : 'Sambungkan Printer'}
            </Text>
          </TouchableOpacity>

          {/* Tombol Reload Web POS */}
          <TouchableOpacity
            style={styles.reloadButton}
            onPress={() => webViewRef.current?.reload()}
          >
            <RefreshCw size={14} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* WEBVIEW KASIR POS NEXT.JS */}
      <View style={styles.webViewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: POS_URL }}
          style={styles.webView}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          scalesPageToFit={true}
          allowsBackForwardNavigationGestures={true}
          onNavigationStateChange={(navState: any) => setCanGoBack(navState.canGoBack)}
          onLoadEnd={() => setWebViewLoading(false)}
          onMessage={handleWebViewMessage}
        />
        {webViewLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#059669" />
            <Text style={styles.loadingText}>Memuat Layar Kasir Serabi Bawel...</Text>
          </View>
        )}
      </View>

      {/* MODAL PILIH PRINTER THERMAL BLUETOOTH */}
      <Modal
        visible={isModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Printer size={20} color="#064E3B" />
                <Text style={styles.modalTitle}>Pengaturan Printer Thermal</Text>
              </View>
              <TouchableOpacity onPress={() => setIsModalOpen(false)} style={styles.closeBtn}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Pilih printer thermal Bluetooth (58mm/80mm) yang sudah dipairing di tablet kasir ini:
            </Text>

            {/* List Perangkat Bluetooth Terpasang */}
            <FlatList
              data={devicesList}
              keyExtractor={(item) => item.address}
              style={styles.deviceList}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  {scanning ? (
                    <ActivityIndicator size="small" color="#059669" />
                  ) : (
                    <Text style={styles.emptyText}>
                      Tidak ada printer Bluetooth ditemukan. Sambungkan (pair) printer di menu Bluetooth Pengaturan HP Anda terlebih dahulu.
                    </Text>
                  )}
                </View>
              }
              renderItem={({ item }) => {
                const isCurrent = connectedPrinterRef.current?.address === item.address;
                const isConnecting = connectingAddress === item.address;
                return (
                  <TouchableOpacity
                    style={[styles.deviceItem, isCurrent && styles.deviceItemActive]}
                    onPress={() => connectToPrinter(item.address, item.name)}
                    disabled={isConnecting}
                  >
                    <View style={styles.deviceInfo}>
                      <Text style={[styles.deviceName, isCurrent && styles.deviceNameActive]}>
                        {item.name}
                      </Text>
                      <Text style={styles.deviceAddress}>{item.address}</Text>
                    </View>
                    {isConnecting ? (
                      <ActivityIndicator size="small" color="#059669" />
                    ) : isCurrent ? (
                      <CheckCircle2 size={18} color="#059669" />
                    ) : (
                      <ChevronRight size={18} color="#94A3B8" />
                    )}
                  </TouchableOpacity>
                );
              }}
            />

            {/* Tombol Aksi Bawah */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.scanButton}
                onPress={loadPairedDevices}
                disabled={scanning}
              >
                <RefreshCw size={14} color="#064E3B" />
                <Text style={styles.scanButtonText}>
                  {scanning ? 'Mencari...' : 'Pindai Ulang'}
                </Text>
              </TouchableOpacity>

              {printerConnected && (
                <TouchableOpacity style={styles.testPrintBtn} onPress={handleTestPrint}>
                  <Zap size={14} color="#FFFFFF" />
                  <Text style={styles.testPrintBtnText}>Test Print 58mm</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#064E3B',
  },
  topBar: {
    height: 48,
    backgroundColor: '#064E3B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandText: {
    color: '#F8FAFC',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  pillBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  pillText: {
    color: '#FCD34D',
    fontSize: 9,
    fontWeight: '800',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  printerStatusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    maxWidth: 180,
  },
  printerConnectedBg: {
    backgroundColor: '#D1FAE5',
  },
  printerDisconnectedBg: {
    backgroundColor: '#FEE2E2',
  },
  printerStatusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  reloadButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  webView: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#064E3B',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 16,
    lineHeight: 18,
  },
  deviceList: {
    maxHeight: 240,
    marginBottom: 16,
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 16,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  deviceItemActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 2,
  },
  deviceNameActive: {
    color: '#064E3B',
  },
  deviceAddress: {
    fontSize: 10,
    color: '#64748B',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  scanButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  scanButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#064E3B',
  },
  testPrintBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#059669',
  },
  testPrintBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
