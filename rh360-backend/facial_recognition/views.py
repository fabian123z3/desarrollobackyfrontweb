from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone
from django.db import transaction
from django.shortcuts import render
from datetime import datetime, timedelta
import uuid
import json
import base64
import os
from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageDraw
import io
import face_recognition
import numpy as np
import cv2
from scipy.spatial import distance
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.http import HttpRequest
import re

from .models import Employee, AttendanceRecord
from .serializers import EmployeeSerializer, AttendanceRecordSerializer
from .face_recognition_utils import AdvancedFaceRecognitionService

face_recognition_service = AdvancedFaceRecognitionService()
ADVANCED_CONFIG = face_recognition_service.ADVANCED_CONFIG

FACE_IMAGES_DIR = 'media/employee_faces/'
os.makedirs(FACE_IMAGES_DIR, exist_ok=True)

def check_duplicate_attendance(employee, attendance_type, timestamp_str, tolerance_minutes=5):
    """
    Verifica si ya existe un registro similar dentro de un margen de tiempo
    """
    try:
        # Convertir timestamp string a datetime
        if isinstance(timestamp_str, str):
            # Manejar diferentes formatos de timestamp
            if timestamp_str.endswith('Z'):
                timestamp_str = timestamp_str.replace('Z', '+00:00')
            target_time = timezone.datetime.fromisoformat(timestamp_str)
        else:
            target_time = timestamp_str
            
        # Buscar registros similares dentro del margen de tolerancia
        time_start = target_time - timedelta(minutes=tolerance_minutes)
        time_end = target_time + timedelta(minutes=tolerance_minutes)
        
        existing = AttendanceRecord.objects.filter(
            employee=employee,
            attendance_type=attendance_type.lower(),
            timestamp__range=(time_start, time_end)
        ).first()
        
        return existing
        
    except Exception as e:
        print(f"Error verificando duplicado: {str(e)}")
        return None

def _create_manual_attendance_record(employee, attendance_type, location_lat, location_lng, address, notes, is_offline_sync, offline_timestamp):
    """
    Función auxiliar para crear un registro de asistencia manual.
    Centraliza la lógica para ser usada por múltiples vistas.
    Ahora con validación anti-duplicados.
    """
    # Verificar duplicados antes de crear
    timestamp_to_check = offline_timestamp if offline_timestamp else timezone.now()
    
    existing_record = check_duplicate_attendance(
        employee=employee,
        attendance_type=attendance_type,
        timestamp_str=timestamp_to_check,
        tolerance_minutes=5  # 5 minutos de tolerancia
    )
    
    if existing_record:
        print(f"⚠️ Registro duplicado detectado para {employee.name} - {attendance_type} cerca de {timestamp_to_check}")
        return existing_record  # Retorna el registro existente en lugar de crear uno nuevo
    
    # Si no hay duplicado, crear el registro normal
    if is_offline_sync and offline_timestamp:
        try:
            # Intenta convertir el timestamp ISO del cliente a un objeto de zona horaria consciente
            record_timestamp = datetime.fromisoformat(offline_timestamp.replace('Z', '+00:00'))
            if record_timestamp.tzinfo is None:
                record_timestamp = timezone.make_aware(record_timestamp)
        except (ValueError, TypeError):
            record_timestamp = timezone.now()
    else:
        record_timestamp = timezone.now()
    
    attendance_record = AttendanceRecord.objects.create(
        employee=employee,
        attendance_type=attendance_type,
        timestamp=record_timestamp,
        location_lat=location_lat,
        location_lng=location_lng,
        address=address,
        verification_method='manual',
        notes=notes or 'Registro manual/GPS',
        is_offline_sync=is_offline_sync
    )
    
    print(f"✅ Nuevo registro creado para {employee.name} - {attendance_type}")
    return attendance_record

def facial_attendance_page(request):
    """Página web para asistencia facial"""
    return render(request, 'asistencia_facial.html')

def validate_chilean_rut(rut):
    """Valida RUT chileno con formato flexible"""
    if not rut:
        return False
    
    clean_rut = re.sub(r'[^0-9kK]', '', str(rut).strip()).upper()
    
    if len(clean_rut) < 8 or len(clean_rut) > 9:
        return False
    
    rut_body = clean_rut[:-1]
    dv = clean_rut[-1]
    
    if not rut_body.isdigit():
        return False
    
    multiplier = 2
    sum_total = 0
    
    for digit in reversed(rut_body):
        sum_total += int(digit) * multiplier
        multiplier = multiplier + 1 if multiplier < 7 else 2
    
    remainder = sum_total % 11
    if remainder == 0:
        expected_dv = '0'
    elif remainder == 1:
        expected_dv = 'K'
    else:
        expected_dv = str(11 - remainder)
    
    return dv == expected_dv

def format_rut_for_storage(rut):
    """Formatea RUT para almacenamiento consistente"""
    if not rut:
        return rut
    
    clean_rut = re.sub(r'[^0-9kK]', '', str(rut).strip()).upper()
    
    if len(clean_rut) < 2:
        return clean_rut
    
    rut_body = clean_rut[:-1]
    dv = clean_rut[-1]
    
    return f"{rut_body}-{dv}"

def search_employee_by_rut(rut):
    """Buscar empleado por RUT con flexibilidad en formato"""
    try:
        # Formato estándar
        employee = Employee.objects.filter(rut=rut, is_active=True).first()
        if employee:
            return employee
        
        # Búsqueda flexible sin puntos ni guiones
        clean_search = re.sub(r'[^0-9kK]', '', rut).upper()
        for emp in Employee.objects.filter(is_active=True):
            clean_emp_rut = re.sub(r'[^0-9kK]', '', emp.rut).upper()
            if clean_emp_rut == clean_search:
                return emp
        
        return None
    except Exception as e:
        print(f"Error buscando empleado por RUT: {str(e)}")
        return None

@api_view(['GET'])
def health_check(request):
    """Estado del sistema"""
    return Response({
        'status': 'OK',
        'message': 'Sistema de Asistencia funcionando correctamente',
        'timestamp': timezone.now().strftime('%d/%m/%Y %H:%M:%S'),
        'system_mode': 'BALANCED_FACIAL_RECOGNITION',
        'features': {
            'facial_recognition': True,
            'qr_verification': True,
            'manual_gps': True,
            'offline_sync': True,
            'web_panel': True
        },
        'config': {
            'photos_required': ADVANCED_CONFIG['min_photos'],
            'face_tolerance': f"{ADVANCED_CONFIG['base_tolerance']} (balanceado)",
            'min_confidence': f"{ADVANCED_CONFIG['min_confidence']:.0%}",
            'verification_timeout': f"{ADVANCED_CONFIG['verification_timeout']} segundos",
            'features': [
                'Registro básico de empleados (solo nombre y RUT)',
                'Registro facial optimizado con 5 fotos',
                'Detección balanceada para condiciones reales',
                'Tolerancia mejorada a variaciones de iluminación',
                'Verificación por código QR + RUT',
                'Procesamiento más rápido y eficiente',
                'Timeout inteligente reducido',
                'Sincronización offline optimizada'
            ],
            'improvements': [
                'Solo 5 fotos necesarias (era 8)',
                'Verificación más rápida (12s vs 15s)',
                'Mayor tolerancia a condiciones de luz',
                'Procesamiento optimizado',
                'Mejor experiencia de usuario'
            ]
        }
    })

@api_view(['POST'])
def create_employee_basic(request):
    """Crear empleado básico sin registro facial"""
    try:
        data = request.data
        name = data.get('name', '').strip()
        rut = data.get('rut', '').strip()
        department = data.get('department', 'General').strip()
        position = data.get('position', 'Empleado').strip()
        email = data.get('email', '').strip()
        
        if not name or not rut:
            return Response({
                'success': False,
                'message': 'Nombre y RUT son requeridos'
            }, status=400)
        
        formatted_rut = format_rut_for_storage(rut)
        
        if not validate_chilean_rut(formatted_rut):
            return Response({
                'success': False,
                'message': f'RUT inválido: {rut}. Verifica el formato y dígito verificador.'
            }, status=400)
        
        if Employee.objects.filter(rut=formatted_rut).exists():
            return Response({
                'success': False,
                'message': f'Ya existe un empleado con RUT {formatted_rut}'
            }, status=400)
        
        employee = Employee.objects.create(
            name=name,
            rut=formatted_rut,
            employee_id=f"EMP{timezone.now().strftime('%Y%m%d%H%M%S')}",
            department=department,
            position=position,
            email=email or '',
            has_face_registered=False,
            is_active=True
        )
        
        serializer = EmployeeSerializer(employee)
        
        return Response({
            'success': True,
            'message': f'✅ Empleado {name} creado exitosamente',
            'employee': serializer.data,
            'next_steps': f'Ahora puedes registrar el rostro de {name} para habilitar reconocimiento facial (5 fotos)',
            'system_mode': 'BALANCED'
        })
        
    except Exception as e:
        return Response({
            'success': False,
            'message': f'Error: {str(e)}'
        }, status=500)

@api_view(['POST'])
def register_employee_face(request):
    """Registrar rostro de empleado con 5 fotos (balanceado)"""
    try:
        data = request.data
        employee_id = data.get('employee_id')
        photos = data.get('photos', [])
        
        if not employee_id:
            return Response({'success': False, 'message': 'ID de empleado requerido'}, status=400)
        
        if len(photos) != ADVANCED_CONFIG['min_photos']:
            return Response({
                'success': False, 
                'message': f'Se requieren exactamente {ADVANCED_CONFIG["min_photos"]} fotos'
            }, status=400)
        
        employee = Employee.objects.get(id=employee_id)
        
        # Procesar y guardar fotos con el servicio avanzado
        result = face_recognition_service.register_employee_optimized(employee_id, employee.name, photos)
        
        if result['success']:
            employee.has_face_registered = True
            employee.save()
            
            return Response({
                'success': True,
                'message': f'✅ Rostro de {employee.name} registrado exitosamente',
                'details': result.get('details', {}),
                'system_mode': 'BALANCED'
            })
        else:
            return Response({
                'success': False,
                'message': result.get('message', 'Error registrando rostro'),
                'system_mode': 'BALANCED'
            }, status=400)
            
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Empleado no encontrado'}, status=404)
    except Exception as e:
        return Response({'success': False, 'message': f'Error: {str(e)}'}, status=500)

@api_view(['POST'])
def verify_attendance_face(request):
    """Verificar asistencia por reconocimiento facial balanceado"""
    try:
        print(f"\n🔍 DEBUGGING verify_attendance_face:")
        print(f"   Método: {request.method}")
        print(f"   Content-Type: {request.content_type}")
        print(f"   Datos recibidos: {list(request.data.keys()) if hasattr(request, 'data') else 'Sin data'}")
        data = request.data
        photo_data = data.get('photo', '')
        attendance_type = data.get('type', 'entrada').lower()
        location_lat = data.get('latitude')
        location_lng = data.get('longitude')
        address = data.get('address', '')
        
        if not photo_data:
            return Response({
                'success': False,
                'message': 'Foto requerida para verificación'
            }, status=400)
        
        start_time = time.time()
        
        # Usar el servicio de reconocimiento facial balanceado
        verification_result, error = face_recognition_service.advanced_verify(photo_data)
        
        elapsed_time = time.time() - start_time
        
        if error or not verification_result or not verification_result.get('best_match'):
            return Response({
            'success': False,
            'message': error or 'Rostro no reconocido',
            'error_type': 'FACE_NOT_RECOGNIZED',
            'system_mode': 'BALANCED'
        }, status=400)

        # Encontrar empleado
        best_match = verification_result['best_match']
        employee_obj = Employee.objects.get(id=best_match['id'])
        best_confidence = verification_result['best_confidence']
        
        # Verificar duplicados antes de crear
        existing_record = check_duplicate_attendance(
            employee=employee_obj,
            attendance_type=attendance_type,
            timestamp_str=timezone.now(),
            tolerance_minutes=5
        )
        
        if existing_record:
            return Response({
                'success': True,  # ← CAMBIAR A True
                'message': f'✅ {attendance_type.upper()} REGISTRADA',
                'employee': {
                    'id': str(employee_obj.id),
                    'name': employee_obj.name,
                    'employee_id': employee_obj.employee_id,
                    'rut': employee_obj.rut,
                    'department': employee_obj.department,
                    'profile_image_url': employee_obj.profile_image.url if employee_obj.profile_image else None
                },
                'verification': {
                    'confidence': f'{best_confidence:.1%}',
                    'method': 'FACIAL_RECOGNITION_BALANCED'
                },
                'duplicate_found': True  # ← Solo para saber internamente
            })
                
        # Crear registro de asistencia
        attendance_record = AttendanceRecord.objects.create(
            employee=employee_obj,
            attendance_type=attendance_type,
            timestamp=timezone.now(),
            location_lat=location_lat,
            location_lng=location_lng,
            address=address,
            verification_method='facial',
            face_confidence=best_confidence,
            notes=f'Reconocimiento facial - Confianza: {best_confidence:.1%}'
        )
        
        serializer = AttendanceRecordSerializer(attendance_record)
        
        return Response({
            'success': True,
            'message': f'✅ {attendance_type.upper()} REGISTRADA',
            'employee': {
                'id': str(employee_obj.id),
                'name': employee_obj.name,
                'employee_id': employee_obj.employee_id,
                'rut': employee_obj.rut,
                'department': employee_obj.department,
                'profile_image_url': employee_obj.profile_image.url if employee_obj.profile_image else None
            },
            'verification': {
                'confidence': f'{best_confidence:.1%}',
                'method': 'FACIAL_RECOGNITION_BALANCED',
                'elapsed_time': f'{elapsed_time:.1f}s',
                'security_level': 'BALANCEADO',
                'system_version': 'BALANCED_v1.0'
            },
            'record': serializer.data,
            'timestamp': timezone.now().strftime('%d/%m/%Y %H:%M:%S')
        })
        
    except Exception as e:
        return Response({
            'success': False,
            'message': f'Error crítico: {str(e)}',
            'error_type': 'SYSTEM_ERROR',
            'system_mode': 'BALANCED'
        }, status=500)

@api_view(['POST'])
def verify_qr(request):
    """Verificar asistencia por código QR + RUT"""
    try:
        data = request.data
        qr_data = data.get('qr_data', '').strip()
        attendance_type = data.get('type', 'entrada').lower()
        location_lat = data.get('latitude')
        location_lng = data.get('longitude')
        address = data.get('address', '')
        
        if not qr_data:
            return Response({
                'success': False,
                'message': 'Código QR requerido'
            }, status=400)
        
        print(f"\n🆔 Verificando QR: {qr_data}")
        
        # Extraer RUT del código QR con múltiples estrategias
        rut_from_qr = None
        
        # Estrategia 1: Buscar patrón de RUT en el texto
        import re
        rut_pattern = r'(\d{7,8}[-]?[0-9kK])'
        rut_matches = re.findall(rut_pattern, qr_data, re.IGNORECASE)
        
        if rut_matches:
            rut_from_qr = rut_matches[0]
            print(f"RUT encontrado por patrón: {rut_from_qr}")
        else:
            # Estrategia 2: Intentar como JSON
            try:
                qr_json = json.loads(qr_data)
                rut_from_qr = qr_json.get('rut') or qr_json.get('RUT') or qr_json.get('run') or qr_json.get('RUN')
            except:
                # Estrategia 3: Asumir que el QR contiene directamente el RUT
                clean_data = re.sub(r'[^0-9kK-]', '', qr_data).upper()
                if len(clean_data) >= 8:
                    rut_from_qr = clean_data
                else:
                    # Estrategia 4: Buscar cualquier secuencia de números seguida de dígito
                    number_pattern = r'(\d{7,8}[0-9kK])'
                    number_matches = re.findall(number_pattern, qr_data, re.IGNORECASE)
                    if number_matches:
                        rut_from_qr = number_matches[0]
        
        if not rut_from_qr:
            return Response({
                'success': False,
                'message': f'No se pudo extraer RUT del código QR. Contenido: {qr_data[:50]}...'
            }, status=400)
        
        # Formatear RUT para búsqueda
        formatted_rut = format_rut_for_storage(rut_from_qr)
        print(f"RUT formateado: {formatted_rut}")
        
        # Validar RUT
        if not validate_chilean_rut(formatted_rut):
            return Response({
                'success': False,
                'message': f'RUT extraído del QR no es válido: {formatted_rut}'
            }, status=400)
        
        # Buscar empleado por RUT
        employee = search_employee_by_rut(formatted_rut)
        if not employee:
            return Response({
                'success': False,
                'message': f'Empleado con RUT {formatted_rut} no encontrado en el sistema'
            }, status=404)
        
        # Verificar duplicados antes de crear
        existing_record = check_duplicate_attendance(
            employee=employee,
            attendance_type=attendance_type,
            timestamp_str=timezone.now(),
            tolerance_minutes=5
        )
        
        if existing_record:
            return Response({
                'success': False,
                'message': f'Ya existe un registro de {attendance_type} reciente para {employee.name}. Última entrada registrada hace menos de 5 minutos.',
                'duplicate_found': True,
                'existing_record': {
                    'timestamp': existing_record.timestamp.strftime('%d/%m/%Y %H:%M:%S'),
                    'type': existing_record.attendance_type
                }
            }, status=400)
        
        # Crear registro de asistencia
        attendance_record = AttendanceRecord.objects.create(
            employee=employee,
            attendance_type=attendance_type,
            timestamp=timezone.now(),
            location_lat=location_lat,
            location_lng=location_lng,
            address=address,
            verification_method='qr',
            qr_verified=True,
            notes=f'Verificación QR exitosa - RUT: {formatted_rut}'
        )
        
        serializer = AttendanceRecordSerializer(attendance_record)
        
        return Response({
            'success': True,
            'message': f'✅ {attendance_type.upper()} REGISTRADA VIA QR',
            'employee': {
                'id': str(employee.id),
                'name': employee.name,
                'employee_id': employee.employee_id,
                'rut': employee.rut,
                'department': employee.department,
                'profile_image_url': employee.profile_image.url if employee.profile_image else None
            },
            'verification': {
                'method': 'QR_CODE_VERIFIED',
                'rut_verified': formatted_rut,
                'qr_content': qr_data[:100],
                'security_level': 'ALTO'
            },
            'record': serializer.data,
            'timestamp': timezone.now().strftime('%d/%m/%Y %H:%M:%S')
        })
        
    except Exception as e:
        return Response({
            'success': False,
            'message': f'Error verificando QR: {str(e)}',
            'error_type': 'QR_VERIFICATION_ERROR'
        }, status=500)

@api_view(['POST'])
def mark_attendance(request):
    """Marcar asistencia manual o procesar verificación"""
    try:
        data = request.data
        
        if data.get('photo'):
            return verify_attendance_face(request)
        
        if data.get('qr_data'):
            return verify_qr(request)
        
        # Lógica de búsqueda de empleado
        employee_name = data.get('employee_name', '').strip()
        employee_id_or_rut = data.get('employee_id', '').strip()
        
        employee = None
        
        # Intenta buscar por RUT si parece un RUT
        if employee_id_or_rut and validate_chilean_rut(employee_id_or_rut):
            employee = search_employee_by_rut(employee_id_or_rut)
            print(f"Búsqueda por RUT ({employee_id_or_rut}): {'✅' if employee else '❌'}")
        
        # Si no se encuentra por RUT, intenta por employee_id interno
        if not employee and employee_id_or_rut:
            try:
                employee = Employee.objects.get(employee_id=employee_id_or_rut, is_active=True)
                print(f"Búsqueda por ID ({employee_id_or_rut}): ✅")
            except Employee.DoesNotExist:
                print(f"Búsqueda por ID ({employee_id_or_rut}): ❌")
        
        # Si no se encuentra por RUT ni por ID, intenta por nombre (como fallback)
        if not employee and employee_name:
            try:
                employee = Employee.objects.get(name__icontains=employee_name, is_active=True)
                print(f"Búsqueda por nombre ({employee_name}): ✅")
            except Employee.DoesNotExist:
                return Response({
                    'success': False,
                    'message': 'No se encontró un empleado con el RUT o nombre proporcionado.'
                }, status=400)
            except Employee.MultipleObjectsReturned:
                return Response({
                    'success': False,
                    'message': 'Múltiples empleados encontrados con ese nombre. Por favor, especifique el RUT.'
                }, status=400)
        
        if not employee:
            return Response({
                'success': False,
                'message': 'No se encontró un empleado con el RUT o nombre proporcionado.'
            }, status=400)
        
        # Llamada a la función auxiliar con verificación anti-duplicados
        attendance_record = _create_manual_attendance_record(
            employee=employee,
            attendance_type=data.get('type', 'entrada').lower(),
            location_lat=data.get('latitude'),
            location_lng=data.get('longitude'),
            address=data.get('address', ''),
            notes=data.get('notes', ''),
            is_offline_sync=data.get('is_offline_sync', False),
            offline_timestamp=data.get('offline_timestamp')
        )
        
        serializer = AttendanceRecordSerializer(attendance_record)
        
        return Response({
            'success': True,
            'message': f'✅ {attendance_record.attendance_type.upper()} registrada manualmente',
            'record': serializer.data,
            'employee': {
                'id': str(employee.id),
                'name': employee.name,
                'employee_id': employee.employee_id,
                'rut': employee.rut,
                'department': employee.department
            },
            'method': 'MANUAL/GPS'
        })
        
    except Exception as e:
        return Response({'success': False, 'message': f'Error: {str(e)}'}, status=500)

@api_view(['POST'])
def sync_offline_records(request):
    """Sincronizar registros offline con validación anti-duplicados"""
    try:
        offline_records = request.data.get('offline_records', [])
        synced_count = 0
        errors = []

        print(f"🔄 Iniciando sincronización de {len(offline_records)} registros offline...")
        
        for record_data in offline_records:
            try:
                response = None
                
                if record_data.get('photo'):
                    print(f"   Procesando registro facial...")
                    mock_request = HttpRequest()
                    mock_request.method = 'POST'
                    mock_request._body = json.dumps(record_data).encode('utf-8')
                    mock_request.content_type = 'application/json'
                    response = verify_attendance_face(mock_request)

                elif record_data.get('qr_data'):
                    print(f"   Procesando registro QR...")
                    mock_request = HttpRequest()
                    mock_request.method = 'POST'
                    mock_request._body = json.dumps(record_data).encode('utf-8')
                    mock_request.content_type = 'application/json'
                    response = verify_qr(mock_request)
                
                else:
                    employee_id = record_data.get('employee_id')
                    employee_name = record_data.get('employee_name')
                    
                    employee_obj = None
                    if employee_id:
                        try:
                            employee_obj = Employee.objects.get(employee_id=employee_id, is_active=True)
                        except Employee.DoesNotExist:
                            pass
                    
                    if not employee_obj and employee_name:
                        try:
                            employee_obj = Employee.objects.get(name__icontains=employee_name, is_active=True)
                        except (Employee.DoesNotExist, Employee.MultipleObjectsReturned):
                            pass
                            
                    if not employee_obj:
                        error_msg = 'Empleado no encontrado para la sincronización'
                        errors.append({'local_id': record_data.get('local_id'), 'error': error_msg, 'data': record_data})
                        print(f"   ❌ Fallo al sincronizar: {error_msg} para ID/nombre {employee_id}/{employee_name}")
                        continue
                    
                    print(f"   Procesando registro manual de {employee_obj.name}...")
                    
                    # La función _create_manual_attendance_record ahora incluye validación anti-duplicados
                    attendance_record = _create_manual_attendance_record(
                        employee=employee_obj,
                        attendance_type=record_data.get('type', 'entrada'),
                        location_lat=record_data.get('latitude'),
                        location_lng=record_data.get('longitude'),
                        address=record_data.get('address', ''),
                        notes='Sincronizado offline',
                        is_offline_sync=True,
                        offline_timestamp=record_data.get('timestamp')
                    )
                    
                    if attendance_record:
                        synced_count += 1
                        print(f"   ✅ Sincronizado exitosamente.")
                    else:
                        print(f"   ⚠️ Registro duplicado omitido.")

                # Procesar la respuesta para los métodos de foto y QR
                if response:
                    if response.status_code in [200, 201]:
                        synced_count += 1
                        print(f"   ✅ Sincronizado exitosamente.")
                    elif response.status_code == 400 and 'duplicate_found' in response.data:
                        print(f"   ⚠️ Registro duplicado omitido.")
                    else:
                        error_msg = response.data.get('message', 'Error desconocido')
                        errors.append({'local_id': record_data.get('local_id'), 'error': error_msg})
                        print(f"   ❌ Fallo al sincronizar: {error_msg}")

            except Exception as e:
                errors.append({'local_id': record_data.get('local_id', 'unknown'), 'error': f'Excepción: {str(e)}'})
                print(f"   ❌ Error al procesar registro: {str(e)}")
        
        print(f"🏁 Sincronización finalizada. Total: {synced_count}/{len(offline_records)} exitosos.")
        
        return Response({
            'success': True,
            'synced_count': synced_count,
            'error_count': len(errors),
            'errors': errors[:10],
            'message': f'Sincronizados {synced_count} de {len(offline_records)} registros',
            'system_mode': 'BALANCED'
        })
        
    except Exception as e:
        return Response({'success': False, 'message': f'Error crítico en la sincronización: {str(e)}'}, status=500)

@api_view(['GET'])
def get_employees(request):
    """Obtener empleados"""
    try:
        employees = Employee.objects.filter(is_active=True).order_by('name')
        serializer = EmployeeSerializer(employees, many=True)
        
        total_employees = employees.count()
        employees_with_faces = employees.filter(has_face_registered=True).count()
        
        return Response({
            'success': True,
            'employees': serializer.data,
            'count': total_employees,
            'employees_with_faces': employees_with_faces,
            'face_registration_rate': f"{(employees_with_faces/total_employees*100):.1f}%" if total_employees > 0 else "0%",
            'system_mode': 'BALANCED_FACIAL_RECOGNITION',
            'features': {
                'basic_registration': True,
                'balanced_facial_recognition': True,
                'photos_required': ADVANCED_CONFIG['min_photos'],
                'qr_verification': True,
                'offline_sync': True,
                'optimized_processing': True
            }
        })
        
    except Exception as e:
        return Response({
            'success': False,
            'message': f'Error: {str(e)}'
        }, status=500)

@api_view(['GET'])
def get_attendance_records(request):
    """Obtener registros"""
    try:
        days = int(request.GET.get('days', 7))
        employee_id = request.GET.get('employee_id')
        limit = int(request.GET.get('limit', 100))
        
        date_from = timezone.now() - timedelta(days=days)
        queryset = AttendanceRecord.objects.select_related('employee').filter(
            timestamp__gte=date_from
        ).order_by('-timestamp')
        
        if employee_id:
            try:
                employee = Employee.objects.get(id=employee_id)
                queryset = queryset.filter(employee=employee)
            except Employee.DoesNotExist:
                pass
        
        total_count = queryset.count()

        # Estadísticas ANTES del slice
        facial_records = queryset.filter(verification_method='facial').count()
        qr_records = queryset.filter(verification_method='qr').count()
        manual_records = queryset.filter(verification_method='manual').count()

        # Slice al final
        records = queryset[:limit]
        serializer = AttendanceRecordSerializer(records, many=True)
        
        return Response({
            'success': True,
            'records': serializer.data,
            'count': len(serializer.data),
            'total': total_count,
            'statistics': {
                'facial_recognitions': facial_records,
                'qr_verifications': qr_records,
                'manual_entries': manual_records
            },
            'system_info': {
                'balanced_face_registration': True,
                'photos_required': ADVANCED_CONFIG['min_photos'],
                'qr_support': True,
                'timeout_seconds': ADVANCED_CONFIG['verification_timeout'],
                'system_mode': 'BALANCED'
            }
        })
        
    except Exception as e:
        return Response({
            'success': False,
            'message': f'Error: {str(e)}'
        }, status=500)

@api_view(['DELETE'])
def delete_employee(request, employee_id):
    """Eliminar empleado completamente"""
    try:
        employee = Employee.objects.get(id=employee_id)
        employee_name = employee.name
        
        # Eliminar fotos guardadas si existen
        for i in range(1, ADVANCED_CONFIG['min_photos'] + 1):
            path = os.path.join(FACE_IMAGES_DIR, f"{employee_id}_variation_{i}.jpg")
            if os.path.exists(path):
                os.remove(path)
        
        AttendanceRecord.objects.filter(employee=employee).delete()
        employee.delete()
        
        return Response({
            'success': True,
            'message': f'{employee_name} eliminado completamente del sistema'
        })
        
    except Employee.DoesNotExist:
        return Response({
            'success': False,
            'message': 'Empleado no encontrado'
        }, status=404)
    except Exception as e:
        return Response({
            'success': False,
            'message': f'Error: {str(e)}'
        }, status=500)

@api_view(['DELETE'])
def delete_attendance(request, attendance_id):
    """Eliminar registro de asistencia"""
    try:
        attendance_record = AttendanceRecord.objects.get(id=attendance_id)
        employee_name = attendance_record.employee.name
        attendance_type = attendance_record.attendance_type
        timestamp = attendance_record.timestamp.strftime('%d/%m/%Y %H:%M')
        
        attendance_record.delete()
        
        return Response({
            'success': True,
            'message': f'Registro eliminado: {employee_name} - {attendance_type} - {timestamp}'
        })
        
    except AttendanceRecord.DoesNotExist:
        return Response({
            'success': False,
            'message': 'Registro no encontrado'
        }, status=404)
    except Exception as e:
        return Response({
            'success': False,
            'message': f'Error: {str(e)}'
        }, status=500)

def attendance_panel(request):
    """Panel web"""
    return render(request, 'attendance_panel.html')
    
@api_view(['POST'])
def update_employee_profile(request, employee_id):
    """Actualizar perfil de empleado (incluye RUT y foto)"""
    try:
        employee = Employee.objects.get(id=employee_id)
        data = request.data
        
        # Actualizar RUT si se proporciona
        new_rut = data.get('rut')
        if new_rut:
            formatted_rut = format_rut_for_storage(new_rut)
            if not validate_chilean_rut(formatted_rut):
                return Response({
                    'success': False,
                    'message': f'RUT inválido: {new_rut}'
                }, status=400)
            
            if Employee.objects.filter(rut=formatted_rut).exclude(id=employee.id).exists():
                return Response({
                    'success': False,
                    'message': f'El RUT {formatted_rut} ya está en uso por otro empleado'
                }, status=400)
            
            employee.rut = formatted_rut
        
        # Guardar la nueva foto de perfil si se proporciona
        photo_data = data.get('photo_data')
        if photo_data:
            format, imgstr = photo_data.split(';base64,')
            ext = format.split('/')[-1]
            photo_name = f'profile_{employee_id}.{ext}'
            
            # Eliminar la foto anterior si existe
            if employee.profile_image:
                if default_storage.exists(employee.profile_image.name):
                    default_storage.delete(employee.profile_image.name)
                    
            photo_file = ContentFile(base64.b64decode(imgstr), name=photo_name)
            employee.profile_image.save(photo_name, photo_file, save=False)
            
        employee.save()
        
        serializer = EmployeeSerializer(employee)
        return Response({
            'success': True,
            'message': f'✅ Perfil de {employee.name} actualizado',
            'employee': serializer.data
        })
        
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Empleado no encontrado'}, status=404)
    except Exception as e:
        return Response({'success': False, 'message': f'Error: {str(e)}'}, status=500)