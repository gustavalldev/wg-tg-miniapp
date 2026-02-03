#!/bin/bash

# WireGuard Manager Script
# Управление peer'ами WireGuard

WG_INTERFACE="wg0"
WG_CONFIG="/etc/wireguard/${WG_INTERFACE}.conf"
WG_DATA_DIR="/var/lib/wireguard"

# Создание peer
create_peer() {
    local name=$1
    local ip=$2
    
    # Генерируем ключи
    local private_key=$(wg genkey)
    local public_key=$(echo "$private_key" | wg pubkey)
    
    # Создаём конфиг для клиента
    local client_config="[Interface]
PrivateKey = $private_key
Address = $ip/24
DNS = 8.8.8.8
MTU = 1280

[Peer]
PublicKey = $(wg show $WG_INTERFACE public-key)
Endpoint = 109.107.170.233:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25"
    
    # Добавляем peer в серверный конфиг
    echo "
[Peer]
# $name
PublicKey = $public_key
AllowedIPs = $ip/32" >> "$WG_CONFIG"
    
    # Сохраняем данные peer'а
    mkdir -p "$WG_DATA_DIR"
    echo "{\"name\":\"$name\",\"ip\":\"$ip\",\"public_key\":\"$public_key\",\"private_key\":\"$private_key\"}" > "$WG_DATA_DIR/$name.json"
    
    # Перезагружаем WireGuard
    wg syncconf $WG_INTERFACE <(wg-quick strip $WG_INTERFACE)
    
    echo "$client_config"
}

# Удаление peer
remove_peer() {
    local name=$1
    
    echo "Удаляю peer: $name"
    
    if [ -f "$WG_DATA_DIR/$name.json" ]; then
        local public_key=$(jq -r '.public_key' "$WG_DATA_DIR/$name.json")
        
        # Удаляем peer из конфига (от # $name до следующего [Peer] или конца файла, включая [Peer])
        awk -v name="$name" '
        BEGIN {del=0}
        /^\[Peer\]/ {if(del){del=0}}
        /# " name "$/ {del=1}
        !del' "$WG_CONFIG" > "$WG_CONFIG.tmp" && mv "$WG_CONFIG.tmp" "$WG_CONFIG"
        
        # Удаляем peer из WireGuard
        wg set $WG_INTERFACE peer "$public_key" remove
        
        # Удаляем файл данных
        rm -f "$WG_DATA_DIR/$name.json"
        
        echo "Peer $name удалён"
    else
        echo "Peer $name не найден"
        exit 1
    fi
}

# Получение конфига peer'а
get_peer_config() {
    local name=$1
    
    if [ -f "$WG_DATA_DIR/$name.json" ]; then
        local private_key=$(jq -r '.private_key' "$WG_DATA_DIR/$name.json")
        local ip=$(jq -r '.ip' "$WG_DATA_DIR/$name.json")
        
        echo "[Interface]
PrivateKey = $private_key
Address = $ip/24
DNS = 8.8.8.8
MTU = 1280

[Peer]
PublicKey = $(wg show $WG_INTERFACE public-key)
Endpoint = 109.107.170.233:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25"
    else
        echo "Peer $name не найден"
        exit 1
    fi
}

# Список всех peer'ов
list_peers() {
    echo "Список peer'ов:"
    if [ -d "$WG_DATA_DIR" ]; then
        for file in "$WG_DATA_DIR"/*.json; do
            if [ -f "$file" ]; then
                local name=$(basename "$file" .json)
                local ip=$(jq -r '.ip' "$file")
                echo "- $name ($ip)"
            fi
        done
    fi
}

# Основная логика
case "$1" in
    "create")
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo "Использование: $0 create <name> <ip>"
            exit 1
        fi
        create_peer "$2" "$3"
        ;;
    "remove")
        if [ -z "$2" ]; then
            echo "Использование: $0 remove <name>"
            exit 1
        fi
        remove_peer "$2"
        ;;
    "config")
        if [ -z "$2" ]; then
            echo "Использование: $0 config <name>"
            exit 1
        fi
        get_peer_config "$2"
        ;;
    "list")
        list_peers
        ;;
    *)
        echo "Использование: $0 {create|remove|config|list}"
        echo "  create <name> <ip> - создать peer"
        echo "  remove <name>      - удалить peer"
        echo "  config <name>      - получить конфиг peer'а"
        echo "  list               - список всех peer'ов"
        exit 1
        ;;
esac 