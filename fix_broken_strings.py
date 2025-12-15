#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para corrigir strings e comentários quebrados em múltiplas linhas
"""

import re
import sys

def fix_broken_strings(content):
    """Corrige strings quebradas em múltiplas linhas"""
    
    # Fix 1: Strings simples quebradas ('texto\nnova linha')
    # Procura por aspas simples com quebra de linha sem barra invertida
    content = re.sub(r"'([^']*?)\r?\n([^']*?)'", r"'\1 \2'", content, flags=re.MULTILINE)
    
    # Fix 2: Strings duplas quebradas ("texto\nnova linha")
    content = re.sub(r'"([^"]*?)\r?\n([^"]*?)"', r'"\1 \2"', content, flags=re.MULTILINE)
    
    # Fix 3: Comentários de linha quebrados sem continuação
    # Procura por // comentário\nlinhaQueNãoÉComentário
    # Nota: Isso é mais complexo, vamos apenas juntar linhas que começam sem indentação adequada
    
    return content

def main():
    input_file = r"c:\Users\Usuário\OneDrive\Desktop\Sistema Operante - Aero Festas\Agenda de eventos.html"
    output_file = r"c:\Users\Usuário\OneDrive\Desktop\Sistema Operante - Aero Festas\Agenda de eventos.html"
    
    print("🔧 Corrigindo strings quebradas...")
    
    try:
        # Ler o arquivo
        with open(input_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        print(f"📄 Arquivo lido: {len(content)} caracteres")
        
        # Aplicar correções múltiplas vezes para pegar todos os casos
        for i in range(5):
            print(f"🔄 Passada {i+1}/5...")
            new_content = fix_broken_strings(content)
            if new_content == content:
                print(f"✅ Nenhuma mudança na passada {i+1}, parando.")
                break
            content = new_content
        
        # Salvar o arquivo
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(content)
        
        print(f"✅ Arquivo corrigido salvo!")
        print(f"📄 Arquivo final: {len(content)} caracteres")
        
    except Exception as e:
        print(f"❌ Erro: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
