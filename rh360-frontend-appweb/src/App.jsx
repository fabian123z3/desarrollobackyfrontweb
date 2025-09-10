import React, { useState, useRef, useEffect } from 'react';
import logo from "./assets/logo.png"
import logorh360 from "./assets/rh360.png"
import successSound from './assets/correcto.mp3';
import errorSound from './assets/falla.mp3';
import asistenciaSound from './assets/asistencia.mp3';
import intenteNuevamenteSound from './assets/intentenuevamente.mp3';
import salida from './assets/salida.mp3';
import contadorSound from './assets/contador.mp3';


// Configuración del backend
const API_BASE_URL = 'https://bc60faf8d7e5.ngrok-free.app';
const NGROK_HEADERS = {
    'ngrok-skip-browser-warning': 'true'
};
const successAudio = new Audio(successSound);
const contadorAudio = new Audio(contadorSound);

const playAudioSequence = (firstAudio, secondAudio) => {
    firstAudio.play().catch(err => console.error(err)); // reproduce el primero
    firstAudio.onended = () => {
        secondAudio.play().catch(err => console.error(err)); // reproduce el segundo
    };
};

const errorAudio = new Audio(errorSound);
const asistenciaAudio = new Audio(asistenciaSound);
const intenteNuevamenteAudio = new Audio(intenteNuevamenteSound);
const salidaAudio = new Audio(salida);

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
    const [showManualLoginModal, setShowManualLoginModal] = useState(false);
    const [manualRut, setManualRut] = useState('');
    const [manualPassword, setManualPassword] = useState('');

    // Nuevo estado para el contador
    const [countdown, setCountdown] = useState(null);
    const [showConfirmation, setShowConfirmation] = useState(false);
    
    // Estado para guardar la foto capturada durante el reconocimiento
    const [capturedPhoto, setCapturedPhoto] = useState(null);

    const videoRef = useRef(null);
    const cameraViewRef = useRef(null);

    // Actualizar hora cada segundo
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Función para detener y reiniciar todos los audios
    const stopAllAudio = () => {
        [successAudio, contadorAudio, errorAudio, asistenciaAudio, intenteNuevamenteAudio, salidaAudio].forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });
    };

    // Verificar estado del sistema
    useEffect(() => {
        const checkSystem = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/health/`, {
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

    // useEffect para manejar el stream de la cámara (se ejecuta solo cuando cameraActive cambia)
    useEffect(() => {
        let stream = null;

        const startCamera = async () => {
            if (!cameraActive || !videoRef.current) return;

            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 1920, max: 1920 },
                        height: { ideal: 1080, max: 1080 },
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


    // useEffect para manejar el contador (se ejecuta solo cuando countdown cambia)
    useEffect(() => {
        let countdownInterval;

        if (countdown !== null && countdown > 0) {
            countdownInterval = setInterval(() => {
                setCountdown(prev => prev - 1);
            }, 1000);
        }

        if (countdown === 0) {
            capturePhoto();
            setCountdown(null);
        }

        return () => {
            if (countdownInterval) {
                clearInterval(countdownInterval);
            }
        };
    }, [countdown]);

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
        setCountdown(null);
        setShowConfirmation(false);
        setCapturedPhoto(null);
        setLoading(false);
    };

    // Iniciar proceso de marcado
    const startAttendance = (type) => {
        if (systemStatus !== 'online' || processing || cameraActive) return;

        stopAllAudio(); // Detiene cualquier audio en curso
        setCurrentProcess(type);
        setCameraActive(true);

        // Iniciar el contador inmediatamente al activar la cámara
        setCountdown(4);
        // Reproducir sonido del contador
        contadorAudio.play().catch(err => console.error(err));
        // Desplazar la pantalla hacia el área de la cámara
        setTimeout(() => {
            if (cameraViewRef.current) {
                cameraViewRef.current.scrollIntoView({ behavior: 'smooth' });
            }
        }, 100);
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
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Convertir a base64
            const imageData = canvas.toDataURL('image/jpeg', 0.85);
            
            // Guardar la foto capturada para mostrarla en la confirmación
            setCapturedPhoto(imageData);

            // Enviar al servidor
            const response = await fetch(`${API_BASE_URL}/api/verify-face/`, {
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
                        isDuplicate: data.duplicate_found,
                        profileImage: employee.profile_image_url // Se guarda la URL de la foto de perfil
                    });
                }

                setShowConfirmation(true);
            } else {
                stopAllAudio(); // Detiene cualquier audio en curso
                // Reproduce el sonido de error
                playAudioSequence(errorAudio, intenteNuevamenteAudio);

                // Error en el reconocimiento
                const errorMsg = data.message || 'Rostro no reconocido';
                showMessage(`❌ ${errorMsg}`, 'error');
                
                setCameraActive(false);
                setShowManualLoginModal(true);
            }

        } catch (error) {
            console.error('Error procesando foto:', error);
            showMessage('❌ Error de conexión. Intenta nuevamente.', 'error');
            resetProcess();
        } finally {
            setProcessing(false);
            setLoading(false);
        }
    };

    const handleManualLogin = async () => {
        if (!manualRut || processing) return;

        stopAllAudio();
        setLoading(true);

        try {
            const response = await fetch(`${API_BASE_URL}/api/mark-attendance/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...NGROK_HEADERS,
                },
                body: JSON.stringify({
                    employee_id: manualRut,
                    type: currentProcess,
                    latitude: null,
                    longitude: null,
                    address: 'Tótem de Asistencia - Ingreso Manual'
                })
            });

            const data = await response.json();
            
            if (response.ok && data.success) {
                const employee = data.employee;
                if (employee) {
                    setRecognizedPerson({
                        name: employee.name,
                        id: employee.employee_id || employee.id,
                        rut: employee.rut,
                        department: employee.department,
                        type: currentProcess,
                        isDuplicate: false
                    });
                }
                setShowConfirmation(true);
                setShowManualLoginModal(false);
            } else {
                showMessage(`❌ Error: ${data.message || 'Empleado no encontrado o datos incorrectos.'}`, 'error');
                setManualRut('');
                setManualPassword('');
                setShowManualLoginModal(false);
                resetProcess();
            }

        } catch (error) {
            console.error('Error en el ingreso manual:', error);
            showMessage('❌ Error de conexión. Intenta nuevamente.', 'error');
            resetProcess();
        } finally {
            setLoading(false);
        }
    };

    const handleRutChange = (e) => {
        const value = e.target.value;
        const filteredValue = value.replace(/[^0-9kK-]/g, '');
        if (filteredValue.length <= 10) {
            setManualRut(filteredValue);
        }
    };

    const closePersonInfo = () => {
        setRecognizedPerson(null);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br flex flex-col">
            {/* Header corporativo */}
            <div className="header">
                <div className="header-container">
                    <div className="header-content-distributed">
                        {/* Logo izquierda */}
                        <div className="header-left">
                            <img src={logo} width="108px" alt="Logo de la empresa" />
                        </div>

                        {/* Sistema activo al centro */}
                        <div className="header-center">
                            <div className={`status-badge ${systemStatus === 'online' ? 'status-online' :
                                systemStatus === 'offline' ? 'status-offline' : 'status-checking'
                                }`}>
                                {systemStatus === 'online' ? '● SISTEMA ACTIVO' :
                                    systemStatus === 'offline' ? '● DESCONECTADO' : '● VERIFICANDO'}
                            </div>
                        </div>

                        {/* Logo derecha */}
                        <div className="header-right">
                            <img src={logorh360} width="60px" alt="Logo RH360" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Contenido principal */}
            <div className="main-container">
                {/* Área principal de interacción */}
                <div className="main-area">
                    <div className="content-container">
                        {/* Vista principal - Sin cámara activa */}
                        {!cameraActive && !showManualLoginModal && (
                            <div className="main-view">
                                <div className="main-card">
                                    <div className="main-header">
                                        <h2 className="main-title">
                                            Control de Asistencia
                                        </h2>
                                        <div className="time-display">
                                            <div className="time-clock">
                                                {currentTime.toLocaleTimeString('es-CL', {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    hour12: false
                                                })}
                                            </div>
                                            <div className="time-clock">
                                                🕐
                                            </div>
                                            <div className="time-clock">
                                                {`${currentTime.getDate().toString().padStart(2, '0')}-${(currentTime.getMonth() + 1).toString().padStart(2, '0')}-${currentTime.getFullYear()}`}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Botones principales */}
                                    <div className="buttons-grid">
                                        <button
                                            onClick={() => startAttendance('entrada')}
                                            disabled={systemStatus !== 'online'}
                                            className="main-button button-entrada"
                                        >
                                            <span className="button-icon">↗️</span>
                                            <div className="button-title">ENTRADA</div>
                                            <div className="button-desc">
                                                Registrar Entrada
                                            </div>
                                        </button>

                                        <button
                                            onClick={() => startAttendance('salida')}
                                            disabled={systemStatus !== 'online'}
                                            className="main-button button-salida"
                                        >
                                            <span className="button-icon">↙️</span>
                                            <div className="button-title">SALIDA</div>
                                            <div className="button-desc">
                                                Registrar salida
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Vista de cámara activa */}
                        {cameraActive && (currentProcess === 'entrada' || currentProcess === 'salida') && (
                            <div className="camera-view" ref={cameraViewRef}>
                                <div className="camera-header">
                                    <h2 className="camera-title">
                                        Registrando {currentProcess?.charAt(0).toUpperCase() + currentProcess?.slice(1)}
                                    </h2>
                                    <p className="camera-subtitle">
                                        Por favor, mira a la cámara y mantente quieto.
                                    </p>
                                    {countdown !== null && (
                                        <div className="countdown-display">
                                            {countdown}
                                        </div>
                                    )}
                                </div>

                                {/* Contenedor de la cámara */}
                                <div className="camera-container">
                                    <video
                                        ref={videoRef}
                                        className="camera-video"
                                        autoPlay
                                        playsInline
                                        muted
                                    />
                                </div>
                            </div>
                        )}

                        {/* Modal de ingreso manual */}
                        {showManualLoginModal && (
                            <div className="modal-overlay">
                                <div className="modal">
                                    <div className="modal-content">
                                        <h2 className="modal-title" style={{ color: '#000' }}>Ingreso Manual</h2>
                                        <p>Ingrese su RUT y contraseña para registrar su asistencia.</p>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                                            <input
                                                type="text"
                                                placeholder="Ingresa tu RUT (ej: 12345678-K)"
                                                value={manualRut}
                                                onChange={handleRutChange}
                                                maxLength={10}
                                                className="form-input"
                                            />
                                            <input
                                                type="password"
                                                placeholder="Ingresa tu contraseña"
                                                value={manualPassword}
                                                onChange={(e) => setManualPassword(e.target.value)}
                                                className="form-input"
                                            />
                                        </div>

                                        <div className="modal-manual-buttons">
                                            <button
                                                onClick={handleManualLogin}
                                                className="modal-button modal-button-manual"
                                                style={{ backgroundColor: '#2563eb' }}
                                            >
                                                Confirmar Asistencia
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setShowManualLoginModal(false);
                                                    resetProcess();
                                                }}
                                                className="modal-button modal-button-manual"
                                                style={{ backgroundColor: '#dc2626' }}
                                            >
                                                Intentar Nuevamente
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Mensaje de estado */}
                        {message && (
                            <div className="message-container">
                                <div className={`message ${messageType === 'success' ? 'message-success' :
                                    messageType === 'error' ? 'message-error' :
                                        'message-warning'
                                    }`}>
                                    {message}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Modal de confirmación */}
            {recognizedPerson && (
                <div className="modal-overlay">
                    <div className="modal">
                        <div className="modal-content">
                            <div className="modal-icon">
                                {recognizedPerson.isDuplicate ? '⚠️' : '✅'}
                            </div>

                            <h2 className={`modal-title ${recognizedPerson.isDuplicate ? 'modal-title-warning' : 'modal-title-success'}`}>
                                {recognizedPerson.isDuplicate ? `${recognizedPerson.type.toUpperCase()} DUPLICADA` : `${recognizedPerson.type.toUpperCase()} REGISTRADA`}
                            </h2>
                            
                            {/* Mostrar la foto capturada durante el reconocimiento */}
                            {capturedPhoto && (
                                <div style={{ marginBottom: '1rem' }}>
                                    <img 
                                        src={capturedPhoto} 
                                        alt="Foto capturada" 
                                        style={{ 
                                            width: '150px', 
                                            height: '150px', 
                                            borderRadius: '50%', 
                                            objectFit: 'cover',
                                            border: '3px solid solid'
                                        }} 
                                    />
                                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
                                        Foto de verificación
                                    </div>
                                </div>
                            )}
                            
                            <div className="modal-info">
                                <div className="modal-name">
                                    {recognizedPerson.name}
                                </div>

                                <div className="modal-details">
                                    <div className="modal-detail-row">
                                        <span className="modal-detail-value">{recognizedPerson.rut}</span>
                                        <span className="modal-detail-label">RUT:</span>
                                    </div>
                                    <div className="modal-detail-row">
                                        <span className="modal-detail-value">{recognizedPerson.department}</span>
                                        <span className="modal-detail-label">Departamento:</span>
                                    </div>
                                </div>
                            </div>
                            
                            {recognizedPerson.isDuplicate && (
                                <div className="modal-warning-box">
                                    <div className="modal-warning-text">
                                        Ya existe un registro de {recognizedPerson.type} reciente
                                    </div>
                                </div>
                            )}

                            {showConfirmation ? (
                                <div className="modal-manual-buttons">
                                    <button
                                        onClick={() => {
                                            // Reproduce el sonido de éxito, y luego el sonido de salida o entrada
                                            if (recognizedPerson.type === 'salida') {
                                                playAudioSequence(successAudio, salidaAudio);
                                            } else {
                                                playAudioSequence(successAudio, asistenciaAudio);
                                            }
                                            setShowConfirmation(false);
                                            setRecognizedPerson(null);
                                            resetProcess();
                                        }}
                                        className="modal-button modal-button-manual"
                                        style={{ backgroundColor: '#16a34a' }}
                                    >
                                        ✅ CONFIRMAR
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowConfirmation(false);
                                            setRecognizedPerson(null);
                                            setCurrentProcess(null);
                                            setCameraActive(false);
                                            showMessage('🔄 Selecciona entrada o salida nuevamente', 'warning');
                                        }}
                                        className="modal-button modal-button-manual"
                                        style={{ backgroundColor: '#dc2626' }}
                                    >
                                        ❌ INTENTAR DE NUEVO
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={closePersonInfo}
                                    className="modal-button"
                                >
                                    CONTINUAR
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Loading overlay */}
            {loading && (
                <div className="loading-overlay">
                    <div className="loading-spinner"></div>
                    <div className="loading-title">
                        PROCESANDO RECONOCIMIENTO
                    </div>
                    <div className="loading-subtitle">
                        Manténgase inmóvil durante el análisis
                    </div>
                </div>
            )}
        </div>
    )
};

export default App;