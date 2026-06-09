# CLAUDE.md

# Mission

Deliver secure, maintainable, scalable, observable, well-tested, and production-ready software.

Always optimize for:

1. Correctness
2. Reliability
3. Security
4. Maintainability
5. Scalability
6. Operability
7. Testability
8. Documentation
9. Automation
10. Business Value

The goal is not merely to make code work.

The goal is to deliver software that can be safely operated and maintained in production.

---

# Agent Usage Policy

Use the most appropriate available agents and skills for each task.

Do not attempt to perform specialized work without invoking the corresponding agent when one exists.

Examples:

* Requirements → Business Analyst Agent
* Architecture → Solution Architect Agent
* Development → Engineering Agents
* Testing → QA Agent
* Security → Security Agent
* Documentation → Technical Writer Agent
* Deployment → DevOps Agent
* Reliability → SRE Agent
* Telecom Validation → TM Forum / Telecom Agent

Multiple agents may collaborate when appropriate.
Please show the agent name who works with the task also.

---

# Mandatory Software Development Lifecycle

All work must follow the lifecycle below.

No phase may be skipped unless explicitly requested.

## Phase 1: Requirement Analysis

Perform:

* Requirement review
* Scope analysis
* Gap analysis
* Assumption identification
* Risk identification
* Dependency identification

Produce:

* Requirement Summary
* Assumptions
* Open Questions
* Risks
* Acceptance Criteria

---

## Phase 2: Solution Design

Perform:

* Architecture analysis
* Component identification
* Integration analysis
* Security analysis
* Scalability analysis

Produce:

* Solution Design
* Architecture Decisions
* Risks
* Trade-offs

For significant changes include:

* Component Diagram
* Sequence Diagram
* Data Flow Diagram
* ADR

---

## Phase 3: Implementation

Code must be:

* Production quality
* Readable
* Modular
* Extensible
* Maintainable

Avoid:

* Hardcoded values
* Duplicate logic
* Dead code
* Premature optimization
* Hidden side effects

Always implement:

* Error handling
* Validation
* Logging
* Configuration management

---

## Phase 4: Verification

Verify:

* Functional requirements
* Non-functional requirements
* Edge cases
* Failure scenarios
* Error handling

Produce:

* Test Results
* Coverage Results
* Validation Findings

---

## Phase 5: Security Review

Review:

* Authentication
* Authorization
* Secrets management
* Sensitive data handling
* Dependency vulnerabilities
* API security

Produce:

* Security Findings
* Risk Assessment
* Mitigation Actions

---

## Phase 6: Documentation

Update all affected documentation.

Documentation is part of the deliverable.

Work is not complete until documentation is complete.

---

## Phase 7: Deployment Readiness

Validate:

* Build process
* Release process
* Rollback process
* Monitoring
* Alerting
* Configuration

Produce:

* Deployment Plan
* Rollback Plan
* Operational Notes

---

## Phase 8: Production Readiness Review

Confirm:

* Quality standards met
* Security standards met
* Documentation complete
* Monitoring configured
* Testing complete

Produce:

* Production Readiness Assessment

---

# Definition of Done

A task is NOT complete until ALL applicable items are satisfied.

## Requirements

* Requirements understood
* Acceptance criteria satisfied
* Assumptions documented

## Code Quality

* Code compiles successfully
* Linting passes
* Formatting passes
* No critical warnings
* No dead code
* No obvious duplication

## Testing

* Unit tests implemented
* Integration tests implemented
* Failure scenarios tested
* Edge cases tested
* Test results reviewed

## Security

* Security review completed
* No critical vulnerabilities
* Secrets protected
* Input validation implemented

## Documentation

* Documentation updated
* API documentation updated
* Deployment instructions updated
* Runbooks updated if required

## Operations

* Logging implemented
* Monitoring implemented
* Health checks implemented

---

# Mandatory Testing Standards

Testing is never optional.

Always generate tests when generating code.

## Unit Testing

Must cover:

* Happy path
* Negative path
* Boundary conditions
* Validation logic
* Error handling

Target:

* Business Logic Coverage >= 90%
* Overall Coverage >= 80%

---

## Integration Testing

Must verify:

* Database interactions
* External APIs
* Event processing
* Message queues
* Service interactions

---

## Contract Testing

Required when APIs exist.

Verify:

* Request compatibility
* Response compatibility
* Backward compatibility

---

## End-to-End Testing

Required for critical workflows.

Validate:

* User journey
* Business process completion
* System integration

---

## Performance Testing

Required for:

* APIs
* Batch jobs
* High-volume processing

Validate:

* Throughput
* Latency
* Resource utilization

---

## Failure Testing

Validate:

* Timeouts
* Dependency failures
* Network interruptions
* Invalid inputs
* Retry behaviour

---

# Documentation Standards

- Every significant change must update documentation.
- Documentation shall be detail enough to ask AI to build it again from scatch.
- Documents shall be generate in HTML format which canbe used by AI

Minimum documentation includes:

## README

Must include:

* Purpose
* Setup
* Build
* Run
* Test
* Configuration

---

## Architecture Documentation

Must include:

* Overview
* Components
* Dependencies
* Integrations

---

## API Documentation

Must include:

* Endpoint definitions
* Request examples
* Response examples
* Error definitions

Use OpenAPI whenever possible.

---

## Operational Documentation

Must include:

* Deployment process
* Rollback process
* Monitoring
* Troubleshooting

---

## Runbook

Must include:

* Common failures
* Recovery steps
* Escalation guidance

---

# Security Standards

Always follow secure-by-default principles.

Mandatory reviews:

## Input Validation

Validate:

* Request payloads
* Query parameters
* Headers
* File uploads

---

## Secrets

Never:

* Hardcode credentials
* Store secrets in source code
* Expose secrets in logs

---

## Authentication

Verify:

* Authentication enforcement
* Token validation
* Session management

---

## Authorization

Verify:

* Access controls
* Privilege boundaries
* Resource ownership

---

## Vulnerability Review

Review for:

* Injection attacks
* Broken authentication
* Sensitive data exposure
* SSRF
* CSRF
* XSS
* Dependency vulnerabilities

---

# Observability Standards

Every production service must provide:

## Logging

Requirements:

* Structured logs
* Correlation IDs
* Error context
* No sensitive data

---

## Metrics

Provide:

* Request count
* Error count
* Latency
* Resource utilization

---

## Tracing

Support:

* Distributed tracing
* Request tracking
* Dependency tracking

---

## Health Endpoints

Provide:

* Liveness
* Readiness

---

# Deployment Standards

Deployment must be repeatable and automated.

Provide:

* Build instructions
* Deployment instructions
* Rollback instructions

Verify:

* Configuration externalized
* Secrets externalized
* Environment consistency

---

# Reliability Standards

Design for failure.

Consider:

* Retries
* Circuit breakers
* Timeouts
* Graceful degradation
* Graceful shutdown

Avoid:

* Single points of failure
* Infinite retries
* Silent failures

---

# Telecom Standards

When telecom domain functionality is involved:

Validate against:

* TM Forum SID
* TM Forum Open APIs
* eTOM

Review:

* Product Ordering
* Service Ordering
* Resource Ordering
* Inventory Management
* Customer Management

Provide:

* SID Mapping
* Compliance Assessment
* Impact Analysis

---

# Go Engineering Standards

For Go projects:

Mandatory:

* context.Context propagation
* Structured logging
* Dependency injection
* Error wrapping
* Graceful shutdown
* Configuration management

Preferred:

* slog or zap
* OpenTelemetry
* Prometheus

Testing:

* Table-driven tests
* Mock external dependencies
* Test concurrent scenarios

---

# Response Expectations

For substantial work always provide:

1. Requirement Analysis
2. Assumptions
3. Risks
4. Design Approach
5. Implementation
6. Testing Strategy
7. Security Review
8. Documentation Updates
9. Deployment Considerations
10. Production Readiness Assessment

Do not stop after generating code.

Ensure the full delivery lifecycle is addressed.

---

# Completion Rule

Never declare a solution complete solely because code has been generated.

A solution is complete only when:

* Design is reviewed
* Code is implemented
* Tests are defined
* Security is reviewed
* Documentation is updated
* Deployment is considered
* Production readiness is assessed
