---
name: api-test-generator
description: Generate pytest test cases for FastAPI endpoints with authentication
tools: Read, Glob, Grep, Bash, Write, Edit
---

# API Test Generator

Generate comprehensive pytest test cases for FastAPI endpoints with proper authentication, validation, and error handling.

## When to Use

Use this skill when:
- Creating new FastAPI endpoints that need tests
- Adding authentication to existing endpoints
- Validating request/response schemas
- Testing error conditions and edge cases

## Workflow

1. **Analyze the target endpoint** - Read the FastAPI route file to understand:
   - Route path and HTTP method
   - Authentication requirements
   - Request/response models
   - Dependencies and business logic

2. **Generate test structure** - Create a pytest test file with:
   - Fixtures for test client and authentication
   - Test cases for successful requests
   - Test cases for authentication failures
   - Test cases for validation errors
   - Test cases for edge cases

3. **Include best practices**:
   - Use `TestClient` from `fastapi.testclient`
   - Mock external dependencies
   - Clean database state between tests
   - Assert proper HTTP status codes
   - Validate response schemas

## Example Output

```python
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.auth.service import verify_token

client = TestClient(app)

def test_get_family_success(auth_header):
    """Test successful family data retrieval"""
    response = client.get("/api/family/123", headers=auth_header)
    assert response.status_code == 200
    assert "family_id" in response.json()
    assert "members" in response.json()

def test_get_family_unauthorized():
    """Test access without authentication"""
    response = client.get("/api/family/123")
    assert response.status_code == 401

def test_get_family_not_found(auth_header):
    """Test accessing non-existent family"""
    response = client.get("/api/family/999", headers=auth_header)
    assert response.status_code == 404
```

## Usage

1. **Claude invocation**: When working on FastAPI endpoints, Claude can use this skill to generate test coverage
2. **User invocation**: Run `/api-test-generator` with the path to the FastAPI route file as an argument

## Notes

- Tests are generated in the `tests/` directory following project structure
- Authentication fixtures use project-specific JWT or OAuth patterns
- Database fixtures handle test data isolation
- Generated tests should be reviewed and adapted for specific business logic