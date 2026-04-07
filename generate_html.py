"""
Run this script once to generate frontend/mehra.html from the embedded template.
Usage: python generate_html.py
"""
import os, sys

output = os.path.join(os.path.dirname(__file__), "frontend", "mehra.html")
print(f"[MEHRA] Note: Place your mehra.html file at:")
print(f"  {output}")
print()
print("The file should contain the full MEHRA single-page application HTML.")
print("The only setting to verify in the HTML is:")
print("  const API = 'http://localhost:8000'")
print("(This is already set correctly in the provided mehra.html)")
