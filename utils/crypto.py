import secrets

# Base32 variant omitting ambiguous characters: I, O, 0, 1
CLEAN_BASE32_CHARS = "ABCDEFGHJKMNPQRSTVWXYZ23456789"

def generate_short_id() -> str:
    """
    Generates a unique, human-readable 6-character identifier
    formatted as XXX-XXX using a cryptographically secure random generator.
    """
    part1 = "".join(secrets.choice(CLEAN_BASE32_CHARS) for _ in range(3))
    part2 = "".join(secrets.choice(CLEAN_BASE32_CHARS) for _ in range(3))
    return f"{part1}-{part2}"

def validate_short_id(short_id: str) -> bool:
    """
    Validates if a given string matches the strict XXX-XXX clean Base32 format.
    """
    if not short_id or len(short_id) != 7 or short_id[3] != '-':
        return False
    
    parts = short_id.split('-')
    if len(parts) != 2:
        return False
        
    for part in parts:
        if len(part) != 3:
            return False
        for char in part:
            if char not in CLEAN_BASE32_CHARS:
                return False
                
    return True