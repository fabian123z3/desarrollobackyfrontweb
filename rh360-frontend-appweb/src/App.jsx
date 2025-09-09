import React, { useState, useRef, useEffect } from 'react';

// Configuración del backend
const API_BASE_URL = 'https://2699959d4052.ngrok-free.app/api';
const NGROK_HEADERS = {
    'ngrok-skip-browser-warning': 'true'
};

const App = () => {
    // Estados principales
    const [systemStatus, setSystemStatus] = useState('checking');
    const [currentProcess, setCurrentProcess] = useState(null);
    const [cameraActive, setCameraActive] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState('');
    const [recognizedPerson, setRecognizedPerson] = useState(null);
    const [loading, setLoading] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());

    const videoRef = useRef(null);

    // Actualizar hora cada segundo
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Verificar estado del sistema
    useEffect(() => {
        const checkSystem = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/health/`, {
                    headers: NGROK_HEADERS
                });
                if (response.ok) {
                    setSystemStatus('online');
                } else {
                    setSystemStatus('offline');
                }
            } catch (error) {
                setSystemStatus('offline');
            }
        };

        checkSystem();
        const interval = setInterval(checkSystem, 30000);
        return () => clearInterval(interval);
    }, []);

    // Manejo de la cámara
    useEffect(() => {
        let stream = null;

        const startCamera = async () => {
            if (!cameraActive || !videoRef.current) return;

            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 1280, max: 1920 },
                        height: { ideal: 720, max: 1080 },
                        facingMode: 'user'
                    }
                });

                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            } catch (error) {
                console.error('Error accediendo a la cámara:', error);
                showMessage('⚠️ No se pudo acceder a la cámara. Verifica los permisos.', 'error');
                resetProcess();
            }
        };

        if (cameraActive) {
            startCamera();
        }

        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [cameraActive]);

    // Auto-reset después de inactividad
    useEffect(() => {
        let timeout;
        if (cameraActive && !processing) {
            timeout = setTimeout(() => {
                resetProcess();
                showMessage('⏰ Tiempo agotado. Intenta nuevamente.', 'warning');
            }, 30000); // 30 segundos
        }
        return () => clearTimeout(timeout);
    }, [cameraActive, processing]);

    // Funciones auxiliares
    const showMessage = (text, type) => {
        setMessage(text);
        setMessageType(type);
        setTimeout(() => {
            setMessage('');
            setMessageType('');
        }, 6000);
    };

    const resetProcess = () => {
        setCameraActive(false);
        setProcessing(false);
        setCurrentProcess(null);
    };

    // Iniciar proceso de marcado
    const startAttendance = (type) => {
        if (systemStatus !== 'online' || processing || cameraActive) return;

        setCurrentProcess(type);
        setCameraActive(true);
        showMessage(`📸 Mira a la cámara y presiona el botón azul para marcar tu ${type.toUpperCase()}`, 'success');
    };

    // Capturar y procesar foto
    const capturePhoto = async () => {
        if (!videoRef.current || processing) return;

        try {
            setProcessing(true);
            setLoading(true);

            // Crear canvas para capturar la imagen
            const canvas = document.createElement('canvas');
            const video = videoRef.current;
            
            canvas.width = Math.min(video.videoWidth, 1280);
            canvas.height = Math.min(video.videoHeight, 720);
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Convertir a base64
            const imageData = canvas.toDataURL('image/jpeg', 0.85);

            // Enviar al servidor
            const response = await fetch(`${API_BASE_URL}/verify-face/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...NGROK_HEADERS
                },
                body: JSON.stringify({
                    photo: imageData,
                    type: currentProcess,
                    latitude: null,
                    longitude: null,
                    address: 'Tótem de Asistencia'
                })
            });

            const data = await response.json();

            if (response.ok && (data.success || data.duplicate_found)) {
                // Reconocimiento exitoso
                const employee = data.employee;
                if (employee) {
                    setRecognizedPerson({
                        name: employee.name,
                        id: employee.employee_id || employee.id,
                        rut: employee.rut,
                        department: employee.department,
                        type: currentProcess,
                        confidence: data.verification?.confidence || 'Alta',
                        isDuplicate: data.duplicate_found
                    });
                }
                
                resetProcess();
            } else {
                // Error en el reconocimiento
                const errorMsg = data.message || 'Rostro no reconocido';
                showMessage(`❌ ${errorMsg}`, 'error');
                
                // Mantener cámara activa para reintento
                setTimeout(() => {
                    if (cameraActive) {
                        showMessage('🔄 Intenta nuevamente. Acércate más a la cámara.', 'warning');
                    }
                }, 3000);
            }

        } catch (error) {
            console.error('Error procesando foto:', error);
            showMessage('❌ Error de conexión. Intenta nuevamente.', 'error');
        } finally {
            setProcessing(false);
            setLoading(false);
        }
    };

    const cancelProcess = () => {
        resetProcess();
        showMessage('❌ Proceso cancelado', 'error');
    };

    const closePersonInfo = () => {
        setRecognizedPerson(null);
        // Auto-mostrar instrucciones después de cerrar
        setTimeout(() => {
            showMessage('👋 ¡Listo! Puedes marcar otra asistencia.', 'success');
        }, 500);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-blue-600 flex flex-col">
            {/* Header con hora y estado */}
            <div className="bg-white bg-opacity-10 backdrop-blur-sm text-white p-4 lg:p-6">
                <div className="max-w-7xl mx-auto flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                        <div className="text-2xl lg:text-3xl font-bold">
                            🏢 Control de Asistencia
                        </div>
                        <div className={`px-4 py-2 rounded-full text-sm lg:text-base font-semibold ${
                            systemStatus === 'online' 
                                ? 'bg-green-500 bg-opacity-80' 
                                : systemStatus === 'offline'
                                ? 'bg-red-500 bg-opacity-80'
                                : 'bg-yellow-500 bg-opacity-80'
                        }`}>
                            {systemStatus === 'online' ? '🟢 Sistema Activo' : 
                             systemStatus === 'offline' ? '🔴 Sin Conexión' : '🟡 Verificando...'}
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-xl lg:text-2xl font-bold">
                            {currentTime.toLocaleTimeString('es-CL', { 
                                hour: '2-digit', 
                                minute: '2-digit' 
                            })}
                        </div>
                        <div className="text-sm lg:text-base opacity-90">
                            {currentTime.toLocaleDateString('es-CL', { 
                                weekday: 'long', 
                                year: 'numeric', 
                                month: 'long', 
                                day: 'numeric' 
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Contenido principal */}
            <div className="flex-1 flex items-center justify-center p-4 lg:p-8">
                <div className="w-full max-w-4xl">
                    
                    {/* Vista principal - Sin cámara activa */}
                    {!cameraActive && (
                        <div className="text-center">
                            {/* Instrucciones principales */}
                            <div className="bg-white rounded-3xl shadow-2xl p-8 lg:p-12 mb-8">
                                <div className="mb-8">
                                    <div className="text-6xl lg:text-8xl mb-4">👤</div>
                                    <h1 className="text-3xl lg:text-5xl font-bold text-gray-800 mb-4">
                                        ¡Marca tu Asistencia!
                                    </h1>
                                    <p className="text-lg lg:text-2xl text-gray-600 mb-8">
                                        Selecciona una opción y sigue las instrucciones
                                    </p>
                                </div>

                                {/* Botones principales - Responsivos */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 max-w-3xl mx-auto">
                                    <button
                                        onClick={() => startAttendance('entrada')}
                                        disabled={systemStatus !== 'online'}
                                        className="group bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 disabled:from-gray-300 disabled:to-gray-400 text-white font-bold py-8 lg:py-12 px-8 rounded-2xl transition-all duration-300 transform hover:scale-105 disabled:hover:scale-100 shadow-xl"
                                    >
                                        <div className="text-4xl lg:text-6xl mb-4">🟢</div>
                                        <div className="text-2xl lg:text-4xl font-bold mb-2">ENTRADA</div>
                                        <div className="text-sm lg:text-lg opacity-90">
                                            Marca tu llegada al trabajo
                                        </div>
                                    </button>
                                    
                                    <button
                                        onClick={() => startAttendance('salida')}
                                        disabled={systemStatus !== 'online'}
                                        className="group bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 disabled:from-gray-300 disabled:to-gray-400 text-white font-bold py-8 lg:py-12 px-8 rounded-2xl transition-all duration-300 transform hover:scale-105 disabled:hover:scale-100 shadow-xl"
                                    >
                                        <div className="text-4xl lg:text-6xl mb-4">🔴</div>
                                        <div className="text-2xl lg:text-4xl font-bold mb-2">SALIDA</div>
                                        <div className="text-sm lg:text-lg opacity-90">
                                            Marca tu salida del trabajo
                                        </div>
                                    </button>
                                </div>

                                {/* Instrucciones adicionales */}
                                <div className="mt-8 lg:mt-12 grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
                                    <div className="bg-blue-50 rounded-xl p-4 lg:p-6">
                                        <div className="text-2xl lg:text-3xl mb-2">📸</div>
                                        <div className="font-semibold text-gray-800 mb-1">Paso 1</div>
                                        <div className="text-sm lg:text-base text-gray-600">
                                            Presiona ENTRADA o SALIDA
                                        </div>
                                    </div>
                                    <div className="bg-green-50 rounded-xl p-4 lg:p-6">
                                        <div className="text-2xl lg:text-3xl mb-2">👀</div>
                                        <div className="font-semibold text-gray-800 mb-1">Paso 2</div>
                                        <div className="text-sm lg:text-base text-gray-600">
                                            Mira directamente a la cámara
                                        </div>
                                    </div>
                                    <div className="bg-purple-50 rounded-xl p-4 lg:p-6">
                                        <div className="text-2xl lg:text-3xl mb-2">✅</div>
                                        <div className="font-semibold text-gray-800 mb-1">Paso 3</div>
                                        <div className="text-sm lg:text-base text-gray-600">
                                            Espera la confirmación
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Vista de cámara activa */}
                    {cameraActive && (
                        <div className="bg-white rounded-3xl shadow-2xl p-6 lg:p-8">
                            <div className="text-center mb-6">
                                <h2 className="text-2xl lg:text-4xl font-bold text-gray-800 mb-4">
                                    📸 Marcando {currentProcess?.toUpperCase()}
                                </h2>
                                <p className="text-lg lg:text-xl text-gray-600">
                                    Posiciónate frente a la cámara y presiona el botón azul
                                </p>
                            </div>

                            {/* Contenedor de la cámara */}
                            <div className="relative bg-black rounded-2xl overflow-hidden aspect-video max-w-3xl mx-auto mb-6">
                                <video
                                    ref={videoRef}
                                    className="w-full h-full object-cover"
                                    autoPlay
                                    playsInline
                                    muted
                                />
                                
                                {/* Overlay con círculo guía */}
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-48 h-48 lg:w-64 lg:h-64 border-4 border-white rounded-full animate-pulse opacity-80"></div>
                                </div>
                                
                                {/* Instrucciones en pantalla */}
                                <div className="absolute top-4 left-4 right-4">
                                    <div className="bg-black bg-opacity-60 text-white text-center py-3 px-4 rounded-xl">
                                        <div className="text-lg lg:text-xl font-semibold">
                                            👤 Posiciónate dentro del círculo
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Contador de tiempo */}
                                <div className="absolute bottom-4 left-4 right-4">
                                    <div className="bg-black bg-opacity-60 text-white text-center py-2 px-4 rounded-xl">
                                        <div className="text-sm lg:text-base">
                                            ⏱️ Tiempo restante: 30 segundos
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Botones de control */}
                            <div className="flex gap-4 lg:gap-6 max-w-2xl mx-auto">
                                <button
                                    onClick={capturePhoto}
                                    disabled={processing}
                                    className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 lg:py-6 px-6 lg:px-8 rounded-2xl text-lg lg:text-2xl transition-all duration-300 transform hover:scale-105 disabled:hover:scale-100"
                                >
                                    {processing ? (
                                        <>
                                            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-white mr-3"></div>
                                            PROCESANDO...
                                        </>
                                    ) : (
                                        <>📸 TOMAR FOTO</>
                                    )}
                                </button>
                                
                                <button
                                    onClick={cancelProcess}
                                    disabled={processing}
                                    className="bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400 text-white font-bold py-4 lg:py-6 px-6 lg:px-8 rounded-2xl text-lg lg:text-2xl transition-colors duration-300"
                                >
                                    ❌ CANCELAR
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Mensaje de estado */}
                    {message && (
                        <div className="fixed bottom-4 left-4 right-4 lg:bottom-8 lg:left-8 lg:right-8 z-30">
                            <div className={`max-w-2xl mx-auto p-4 lg:p-6 rounded-2xl text-center font-bold text-lg lg:text-xl shadow-2xl ${
                                messageType === 'success' ? 'bg-green-500 text-white' :
                                messageType === 'error' ? 'bg-red-500 text-white' :
                                'bg-yellow-500 text-black'
                            }`}>
                                {message}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer informativo */}
            <div className="bg-white bg-opacity-10 backdrop-blur-sm text-white p-4 text-center">
                <div className="text-sm lg:text-base opacity-80">
                    🔐 Sistema seguro con reconocimiento facial | 📱 Compatible con todos los dispositivos
                </div>
            </div>

            {/* Modal de confirmación - Pantalla completa en móvil */}
            {recognizedPerson && (
                <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-3xl p-6 lg:p-8 max-w-lg w-full shadow-2xl transform animate-bounce">
                        <div className="text-center">
                            {/* Icono de éxito */}
                            <div className="text-8xl lg:text-9xl mb-6">
                                {recognizedPerson.isDuplicate ? '⚠️' : '✅'}
                            </div>
                            
                            {/* Título */}
                            <h2 className="text-2xl lg:text-3xl font-bold mb-6">
                                {recognizedPerson.isDuplicate ? (
                                    <span className="text-yellow-600">¡Ya Registrado!</span>
                                ) : (
                                    <span className="text-green-600">¡Registro Exitoso!</span>
                                )}
                            </h2>
                            
                            {/* Información del empleado */}
                            <div className="bg-gray-50 rounded-2xl p-6 mb-6">
                                <div className="text-2xl lg:text-3xl font-bold text-blue-700 mb-4">
                                    👤 {recognizedPerson.name}
                                </div>
                                
                                <div className="grid grid-cols-1 gap-3 text-left">
                                    <div className="flex justify-between items-center py-2 border-b border-gray-200">
                                        <span className="font-semibold text-gray-700">📋 ID Empleado:</span>
                                        <span className="font-mono text-gray-900">{recognizedPerson.id}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-2 border-b border-gray-200">
                                        <span className="font-semibold text-gray-700">🆔 RUT:</span>
                                        <span className="font-mono text-gray-900">{recognizedPerson.rut}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-2 border-b border-gray-200">
                                        <span className="font-semibold text-gray-700">🏢 Departamento:</span>
                                        <span className="text-gray-900">{recognizedPerson.department}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-2">
                                        <span className="font-semibold text-gray-700">📍 Acción:</span>
                                        <span className={`font-bold px-3 py-1 rounded-full text-white ${
                                            recognizedPerson.type === 'entrada' ? 'bg-green-500' : 'bg-red-500'
                                        }`}>
                                            {recognizedPerson.type?.toUpperCase()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Información adicional */}
                            <div className="bg-blue-50 rounded-xl p-4 mb-6">
                                <div className="text-sm lg:text-base font-semibold text-blue-700 mb-1">
                                    🎯 Confianza: {recognizedPerson.confidence}
                                </div>
                                <div className="text-sm text-gray-600">
                                    ⏰ {new Date().toLocaleString('es-CL')}
                                </div>
                            </div>
                            
                            {/* Mensaje adicional para duplicados */}
                            {recognizedPerson.isDuplicate && (
                                <div className="bg-yellow-100 border border-yellow-300 rounded-xl p-4 mb-6">
                                    <div className="text-yellow-800 font-semibold">
                                        ⏰ Ya tienes un registro de {recognizedPerson.type} reciente
                                    </div>
                                </div>
                            )}
                            
                            {/* Botón de continuar */}
                            <button
                                onClick={closePersonInfo}
                                className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 lg:py-5 px-6 rounded-2xl text-lg lg:text-xl transition-all duration-300 transform hover:scale-105"
                            >
                                ✅ CONTINUAR
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Loading overlay global */}
            {loading && (
                <div className="fixed inset-0 bg-white bg-opacity-95 flex flex-col items-center justify-center z-40">
                    <div className="w-16 h-16 lg:w-20 lg:h-20 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-6"></div>
                    <div className="text-xl lg:text-2xl font-bold text-gray-800 mb-2">
                        🔍 Analizando rostro...
                    </div>
                    <div className="text-lg lg:text-xl text-gray-600">
                        Por favor mantente quieto
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;