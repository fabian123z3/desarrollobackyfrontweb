import React, { useState, useRef, useEffect } from 'react';

// Configuración - Conexión al Backend
// ⚠️ IMPORTANTE: DEBES ACTUALIZAR ESTA URL CADA VEZ QUE INICIES NGROK.
const API_BASE_URL = 'https://be4157ccb2b0.ngrok-free.app';

const App = () => {
    // Estado de la aplicación
    const [status, setStatus] = useState('offline');
    const [processType, setProcessType] = useState(null);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [resultMessage, setResultMessage] = useState('');
    const [resultType, setResultType] = useState('');
    const [employeeInfo, setEmployeeInfo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingText, setLoadingText] = useState('');

    // Referencias a elementos del DOM
    const videoRef = useRef(null);

    // Verificar el estado del sistema
    const checkSystemStatus = async () => {
        try {
            setLoadingText('Verificando estado del sistema...');
            setLoading(true);
            console.log('🔄 Verificando estado del sistema...');
            
            const response = await fetch(`${API_BASE_URL}/health/`);
            if (!response.ok) {
                throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            console.log('✅ Respuesta del sistema:', data);
            
            if (data.status === 'OK') {
                setStatus('online');
                console.log('✅ Sistema online');
            } else {
                throw new Error('Sistema no disponible');
            }
        } catch (error) {
            setStatus('offline');
            console.error('❌ Error verificando sistema:', error);
            showResult(`🔴 Error de conexión: ${error.message}. Verifica que ngrok esté activo.`, 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        checkSystemStatus();
        const intervalId = setInterval(checkSystemStatus, 30000);
        return () => clearInterval(intervalId);
    }, []);

    // Manejo de la cámara
    useEffect(() => {
        let streamInstance = null;
        
        const startCamera = async () => {
            if (!isCameraActive || isProcessing || !videoRef.current) return;
            
            console.log('📹 Iniciando cámara...');

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                const isHTTPS = window.location.protocol === 'https:';
                const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                
                if (!isHTTPS && !isLocalhost) {
                    throw new Error('⚠️ CÁMARA REQUIERE HTTPS - Usa ngrok o accede desde localhost');
                } else {
                    throw new Error('Tu navegador no soporta acceso a cámara');
                }
            }

            try {
                streamInstance = await navigator.mediaDevices.getUserMedia({
                    video: { 
                        width: { ideal: 640 }, 
                        height: { ideal: 480 }, 
                        facingMode: 'user' 
                    }
                });
                
                if (streamInstance && streamInstance.getVideoTracks().length > 0) {
                    videoRef.current.srcObject = streamInstance;
                    
                    await new Promise((resolve, reject) => {
                        videoRef.current.onloadedmetadata = resolve;
                        videoRef.current.onerror = reject;
                        setTimeout(() => reject(new Error('Timeout cargando video')), 5000);
                    });
                    
                    console.log('✅ Cámara iniciada correctamente');
                }
            } catch (error) {
                console.error('❌ Error iniciando cámara:', error);
                let errorMessage = 'No se pudo acceder a la cámara. ';
                switch (error.name) {
                    case 'NotAllowedError':
                        errorMessage += 'Permite el acceso a la cámara en la configuración del navegador.';
                        break;
                    case 'NotFoundError':
                        errorMessage += 'No se encontró ninguna cámara en el dispositivo.';
                        break;
                    case 'NotReadableError':
                        errorMessage += 'La cámara está siendo usada por otra aplicación.';
                        break;
                    default:
                        errorMessage += `Error: ${error.message}`;
                }
                showResult(errorMessage, 'error');
                resetInterface();
            }
        };

        if (isCameraActive) {
            startCamera();
        }

        return () => {
            if (streamInstance) {
                streamInstance.getTracks().forEach(track => track.stop());
                console.log('🛑 Cámara detenida');
            }
        };
    }, [isCameraActive, isProcessing]);

    const markAttendance = (type) => {
        if (isProcessing || isCameraActive) {
            console.log('⚠️ Proceso ya en curso');
            return;
        }
        
        if (status !== 'online') {
            showResult('❌ Sistema sin conexión', 'error');
            return;
        }
        
        console.log(`🚀 Iniciando proceso de ${type}`);
        setProcessType(type);
        clearResult();
        setIsCameraActive(true);
        showResult(`📸 Presiona TOMAR FOTO para ${type.toUpperCase()}`, 'success');
    };

    const takePhoto = async () => {
        if (!isCameraActive || isProcessing) {
            showResult('❌ Cámara no disponible', 'error');
            return;
        }
        
        if (!videoRef.current || videoRef.current.readyState !== 4) {
            showResult('❌ Video no está listo', 'error');
            return;
        }
        
        try {
            setIsProcessing(true);
            setLoadingText(`Procesando ${processType.toUpperCase()}...`);
            setLoading(true);
            
            console.log('📸 Tomando foto...');
            
            // Esperar un momento para que la UI se actualice
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            
            // Configurar canvas con las dimensiones del video
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            
            // Dibujar el frame actual del video
            context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            
            // Convertir a base64 con mejor calidad
            const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95); 
            
            console.log('📸 Foto capturada, tamaño:', imageDataUrl.length, 'caracteres');
            
            await processPhoto(imageDataUrl, processType);
            
        } catch (error) {
            console.error('❌ Error tomando foto:', error);
            showResult('❌ Error al tomar la foto', 'error');
        } finally {
            setIsProcessing(false);
            setLoading(false);
        }
    };

    const processPhoto = async (photoData, type) => {
        try {
            console.log(`🔍 Procesando ${type} con reconocimiento facial...`);
            
            // Validar que la foto tenga contenido
            if (!photoData || !photoData.startsWith('data:image/')) {
                throw new Error('Formato de imagen inválido');
            }
            
            // Preparar datos para envío
            const requestData = {
                photo: photoData,
                type: type,
                latitude: null,
                longitude: null,
                address: 'Registro Web Facial'
            };
            
            console.log('📤 Enviando datos:', {
                ...requestData,
                photo: `${photoData.substring(0, 50)}... (${photoData.length} chars)`
            });
            
            const response = await fetch(`${API_BASE_URL}/verify-face/`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });
            
            console.log('📥 Status de respuesta:', response.status, response.statusText);
            
            const responseText = await response.text();
            console.log('📥 Respuesta raw:', responseText);
            
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                throw new Error(`Respuesta no es JSON válido: ${responseText.substring(0, 200)}`);
            }
            
            console.log('📥 Datos parseados:', data);
            
            if (response.ok && (data.success || data.duplicate_found)) {
                console.log('✅ Reconocimiento exitoso!');
                showResult(`✅ ¡${type.toUpperCase()} REGISTRADA!`, 'success', data);
                resetInterface();
            } else {
                const errorMessage = data.message || `Error ${response.status}: ${response.statusText}`;
                console.log('❌ Error del servidor:', errorMessage);
                showResult(`❌ ${errorMessage}`, 'error');
                
                setTimeout(() => {
                    if (isCameraActive) {
                        showResult(`🔄 Intenta de nuevo - ${type.toUpperCase()}`, 'warning');
                    }
                }, 3000);
            }
            
        } catch (error) {
            console.error('❌ Error completo:', error);
            showResult(`❌ Error: ${error.message}`, 'error');
            
            setTimeout(() => {
                if (isCameraActive) {
                    showResult(`🔄 Intenta de nuevo - ${type.toUpperCase()}`, 'warning');
                }
            }, 3000);
        }
    };

    const cancelProcess = () => {
        console.log('🚫 Proceso cancelado por el usuario');
        resetInterface();
        showResult('🚫 Proceso cancelado', 'error');
    };

    const resetInterface = () => {
        setIsCameraActive(false);
        setIsProcessing(false);
        setProcessType(null);
        setEmployeeInfo(null);
        setTimeout(clearResult, 3000);
    };

    const clearResult = () => {
        setResultMessage('');
        setResultType('');
        setEmployeeInfo(null);
    };

    const showResult = (message, type, data = null) => {
        console.log(`📢 Mostrando resultado: ${message} (${type})`);
        setResultMessage(message);
        setResultType(type);
        
        if (data && (data.success || data.duplicate_found)) {
            const employee = data.employee || { 
                name: 'Empleado', 
                employee_id: 'ID', 
                rut: 'RUT', 
                department: 'Departamento' 
            };
            const verification = data.verification || { confidence: '95%' };
            setEmployeeInfo({ ...employee, verification, type });
            
            console.log('👤 Información del empleado:', employee);
        }
    };

    return (
        <div className="bg-gray-100 min-h-screen flex items-center justify-center p-4" style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
        }}>
            <div className="container bg-white rounded-2xl shadow-xl p-6 text-center w-full max-w-sm sm:max-w-md lg:max-w-lg mx-auto mt-5">
                <h1 className="text-3xl font-extrabold text-gray-900 mb-2">
                    Control de Asistencia
                </h1>
                <div className={`status px-4 py-1 rounded-full font-semibold text-sm mb-4 transition-colors duration-300 ${
                    status === 'online' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                    {status === 'online' ? '🟢 Sistema listo' : '🔴 Sin conexión'}
                </div>
                
                <div className="main-buttons grid grid-cols-2 gap-4 my-4">
                    <button
                        className="btn-main btn-entrada px-6 py-4 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => markAttendance('entrada')}
                        disabled={status !== 'online' || isProcessing || isCameraActive}
                    >
                        📸 ENTRADA
                    </button>
                    <button
                        className="btn-main btn-salida px-6 py-4 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => markAttendance('salida')}
                        disabled={status !== 'online' || isProcessing || isCameraActive}
                    >
                        📸 SALIDA
                    </button>
                </div>

                <div className="qr-section my-4">
                    <p className="text-xs text-gray-600 mb-2">¿No funciona la cámara? Usa código QR:</p>
                    <button
                        className="btn-qr px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg"
                        onClick={() => alert('Escanea QR con el RUT del empleado')}
                    >
                        📱 Marcar con QR
                    </button>
                </div>

                <div className={`camera-section flex flex-col items-center my-4 ${isCameraActive ? 'block' : 'hidden'}`}>
                    <div className="camera-container relative w-full aspect-[4/3] bg-black rounded-xl overflow-hidden shadow-lg mb-4 flex items-center justify-center">
                        <div className={`camera-placeholder absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-sm p-4 text-center ${isCameraActive ? 'hidden' : 'flex'}`}>
                            <div>📷 Cámara inactiva</div>
                            <div className="mt-2 text-xs">Presiona un botón para iniciar</div>
                        </div>
                        <video 
                            ref={videoRef} 
                            className={`camera w-full h-full object-cover ${!isCameraActive ? 'hidden' : 'block'}`} 
                            autoPlay 
                            playsInline
                            muted
                        />
                        <div className="face-overlay absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/5 aspect-square rounded-full border-4 border-white shadow-md animate-pulse"></div>
                    </div>
                    
                    <button
                        className={`photo-button px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-full transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${!isCameraActive ? 'hidden' : 'block'}`}
                        onClick={takePhoto}
                        disabled={isProcessing}
                    >
                        {isProcessing ? '⏳ PROCESANDO...' : '📸 TOMAR FOTO'}
                    </button>
                    
                    <button
                        className={`cancel-btn px-4 py-2 mt-2 bg-gray-500 hover:bg-gray-600 text-white font-semibold rounded-xl text-xs transition-all duration-300 ${!isCameraActive ? 'hidden' : 'block'}`}
                        onClick={cancelProcess}
                        disabled={isProcessing}
                    >
                        ❌ Cancelar
                    </button>
                </div>
                
                {resultMessage && (
                    <div className={`result p-3 my-4 rounded-xl text-sm font-semibold transition-all duration-300 ${
                        resultType === 'success' ? 'bg-green-100 text-green-800' : 
                        resultType === 'error' ? 'bg-red-100 text-red-800' : 
                        'bg-yellow-100 text-yellow-800'
                    }`}>
                        {resultMessage}
                    </div>
                )}
                
                {employeeInfo && (
                    <div className="employee-info bg-blue-100 border border-blue-400 rounded-xl p-4 my-4">
                        <div className="employee-name text-lg font-bold text-blue-700">{employeeInfo.name}</div>
                        <div className="employee-details text-xs text-gray-600 mt-2">
                            <p>📋 {employeeInfo.employee_id} | 🆔 {employeeInfo.rut}</p>
                            <p>🏢 {employeeInfo.department} | 📍 {employeeInfo.type.toUpperCase()}</p>
                        </div>
                        <div className="confidence text-xs font-semibold text-green-600 mt-2">
                            🎯 {employeeInfo.verification.confidence} | ⏰ {new Date().toLocaleString('es-CL')}
                        </div>
                    </div>
                )}
            </div>
            
            {loading && (
                <div className="loading fixed inset-0 flex flex-col items-center justify-center bg-white bg-opacity-95 z-50">
                    <div className="spinner w-10 h-10 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin"></div>
                    <div className="loading-text mt-4 text-gray-800 font-semibold text-base">{loadingText}</div>
                </div>
            )}
        </div>
    );
};

export default App;