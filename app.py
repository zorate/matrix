import os
import time
import sys
import secrets
from collections import defaultdict
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room
from pymongo import MongoClient
from utils.crypto import generate_short_id, validate_short_id
from dotenv import load_dotenv
from pymongo.errors import ConfigurationError, ServerSelectionTimeoutError

# REMOVED: from anyio import ASGIWrapper

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', secrets.token_hex(32))

# Initialize SocketIO normally
socketio = SocketIO(app, cors_allowed_origins="*")

# This works natively out of the box without any extra imports
asgi_app = socketio.asgi_app

load_dotenv()
# MongoDB Connection Setup
MONGO_URI = os.getenv('MONGO_URI')
mongo_client = MongoClient(MONGO_URI)
db = mongo_client["TrustCheck"]

if not MONGO_URI:
    print("\n" + "="*70)
    print("FATAL CONFIGURATION ERROR: MONGO_URI missing from environment variables.")
    print("Please check that your .env file exists and contains the variable.")
    print("="*70 + "\n")
    sys.exit(1)

try:
    mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db = mongo_client.get_default_database()
    users_col = db["users"]
    mongo_client.server_info()
    print("SUCCESS: Established secure pipeline with MongoDB Atlas cloud clusters.")
    
except ConfigurationError as ce:
    print(f"\nConfiguration error parsing URI mapping: {ce}")
    print("Double check your connection string syntax inside the .env wrapper.\n")
    sys.exit(1)
except ServerSelectionTimeoutError:
    print("\n" + "="*70)
    print("FATAL NETWORK ERROR: Unable to communicate with MongoDB Atlas clusters.")
    print("1. Verify your local machine has an active internet connection.")
    print("2. Ensure your IP address is whitelisted in the MongoDB Atlas Network Access panel.")
    print("="*70 + "\n")
    sys.exit(1)

users_col = db['users']              
undelivered_col = db['undelivered_queue']  

rate_limit_store = defaultdict(list)
RATE_LIMIT_WINDOW = 60  
RATE_LIMIT_MAX_REQUESTS = 3

def is_rate_limited(ip: str) -> bool:
    current_time = time.time()
    rate_limit_store[ip] = [t for t in rate_limit_store[ip] if current_time - t < RATE_LIMIT_WINDOW]
    if len(rate_limit_store[ip]) >= RATE_LIMIT_MAX_REQUESTS:
        return True
    rate_limit_store[ip].append(current_time)
    return False

connected_users = {} 
active_rooms = defaultdict(set) 

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/pairing')
def pairing():
    return render_template('pairing.html')

@app.route('/alias')
def alias():
    return render_template('alias.html')

@app.route('/api/identity/register', methods=['POST'])
def register_identity():
    data = request.get_json() or {}
    public_key = data.get('public_key')
    
    if not public_key or not isinstance(public_key, str):
        return jsonify({'error': 'Invalid public key payload'}), 400

    attempts = 0
    while attempts < 10:
        short_id = generate_short_id()
        if users_col.count_documents({'short_key': short_id}) == 0:
            users_col.insert_one({
                'short_key': short_id,
                'public_key': public_key
            })
            return jsonify({'short_key': short_id}), 201
        attempts += 1
        
    return jsonify({'error': 'Keyspace generation collision overflow'}), 500

@app.route('/api/identity/lookup/<short_id>', methods=['GET'])
def lookup_identity(short_id):
    client_ip = request.remote_addr or "127.0.0.1"
    
    if is_rate_limited(client_ip):
        return jsonify({'error': 'Rate limit exceeded. Maximum 3 queries per minute.'}), 422
        
    short_id = short_id.upper().strip()
    if not validate_short_id(short_id):
        return jsonify({'error': 'Invalid identity structural format'}), 400
        
    user = users_col.find_one({'short_key': short_id}, {'_id': 0, 'public_key': 1})
    if not user:
        return jsonify({'error': 'Identity key pointer not found'}), 404
        
    return jsonify({'public_key': user['public_key']}), 200

@socketio.on('connect')
def handle_connect():
    pass

@socketio.on('authenticate')
def handle_authenticate(data):
    short_key = data.get('short_key')
    if not short_key or users_col.count_documents({'short_key': short_key}) == 0:
        return False
        
    connected_users[request.sid] = short_key
    join_room(short_key)
    
    offline_messages = undelivered_col.find({'recipient_id': short_key})
    for msg in offline_messages:
        emit('receive_message', msg['payload'], room=short_key)
        undelivered_col.delete_one({'_id': msg['_id']})

@socketio.on('send_msg')
def handle_send_message(data):
    sender_sid = request.sid
    sender_key = connected_users.get(sender_sid)
    if not sender_key:
        return 
        
    recipient_id = data.get('recipient_id')
    encrypted_payload = data.get('encrypted_payload') 
    
    if not recipient_id or not encrypted_payload:
        return

    payload_packet = {
        'sender_id': sender_key,
        'payload': encrypted_payload,
        'timestamp': int(time.time())
    }

    recipient_active = False
    if recipient_id in connected_users.values():
        recipient_active = True

    if recipient_active:
        emit('receive_message', payload_packet, room=recipient_id)
    else:
        undelivered_col.insert_one({
            'recipient_id': recipient_id,
            'payload': payload_packet,
            'timestamp': int(time.time())
        })

@socketio.on('disconnect')
def handle_disconnect():
    if request.sid in connected_users:
        del connected_users[request.sid]

if __name__ == '__main__':
    socketio.run(app, host='127.0.0.1', port=5000, debug=True, use_reloader=False)
