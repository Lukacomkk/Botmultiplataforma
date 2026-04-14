import os
import sys
from datetime import datetime

def show_greeting():
    # Obtém o nome do usuário do sistema
    user = os.getenv('USER') or os.getenv('USERNAME') or "User"
    # Obtém a hora atual
    current_time = datetime.now().strftime("%H:%M:%S")
    
    # Design do banner no terminal
    print("\n" + "="*40)
    print(f"  SYSTEM STATUS: ONLINE | {current_time}")
    print(f"  WELCOME, {user.upper()}")
    print("="*40)
    print("  Ready for auditing and development.")
    print("="*40 + "\n")

if __name__ == "__main__":
    show_greeting()
